// src/modules/classification/classification.repo.ts
import type { RowDataPacket } from "mysql2";
import { pool } from "../../db";
import { qid } from "../../data/sql";
import type { Classification, PageResult } from "../../types/domain";

export interface PageOptions {
    page?: number;
    pageSize?: number;
    search?: string;
    orderBy?: string;
    orderDir?: "asc" | "desc";
    season_id?: number;
    league_id?: number;
    user_id?: number;
    question_id?: number;
    virtual?: boolean; // default real if omitted
}

const DEFAULT_PAGE_SIZE = 25;

const ORDERABLE = new Set([
    "season_id","league_id","user_id","question_id",
    "points","score","sequence","seed","virtual",
    "insertion","changed","score_ball"
]);

/** Source-of-truth list; used to build both unqualified and qualified SELECTs */
const SELECT_LIST = [
    "season_id","league_id","user_id","question_id",
    "points","score","sequence","seed","virtual",
    "insertion","changed","score_ball"
] as const;

/** Your original constant (kept exactly as-is) */
export const SELECT_COLUMNS = SELECT_LIST.map(qid).join(", ");

/** Same columns, but qualified with alias `c.` for join queries */
const SELECT_COLUMNS_C = SELECT_LIST.map((c) => `c.${qid(c)}`).join(", ");

/** Columns that compute previous rank + movement once, reused where needed */
const MOVEMENT_COLUMNS = `
  p.${qid("seed")} AS prev_seed,
  CASE
    WHEN p.${qid("seed")} IS NULL THEN NULL
    ELSE (p.${qid("seed")} - c.${qid("seed")})
  END AS movement
`;

// WHERE fragment for virtual vs real
function whereForVirtual(isVirtual: boolean, alias?: string) {
    const col = alias ? `${alias}.${qid("virtual")}` : qid("virtual");
    return isVirtual
        ? ` AND ${col} = '1'`
        : ` AND (${col} IS NULL OR ${col} = '0' OR ${col} = '')`;
}

function buildWhere(opts: PageOptions) {
    const where: string[] = [];
    const params: any[] = [];

    if (opts.season_id != null) { where.push(`${qid("season_id")} = ?`); params.push(opts.season_id); }
    if (opts.league_id != null) { where.push(`${qid("league_id")} = ?`); params.push(opts.league_id); }
    if (opts.user_id   != null) { where.push(`${qid("user_id")} = ?`);   params.push(opts.user_id); }
    if (opts.question_id != null) { where.push(`${qid("question_id")} = ?`); params.push(opts.question_id); }

    if (opts.search) {
        // there isn't really a text column in SELECT_LIST; keep behavior
        where.push(`(${qid("virtual")} LIKE ?)`);
        params.push(`%${opts.search}%`);
    }

    const whereSql = `WHERE ${where.length ? where.join(" AND ") : "1=1"}${whereForVirtual(!!opts.virtual)}`;
    return { whereSql, params };
}

// Optional: paged list (admin/tools)
export async function getClassificationPage(opts: PageOptions = {}): Promise<PageResult<Classification>> {
    const pageSize = Math.max(1, Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, 200));
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * pageSize;

    const orderByRaw = (opts.orderBy && ORDERABLE.has(opts.orderBy)) ? opts.orderBy : "season_id";
    const orderBy = qid(orderByRaw);
    const orderDir = (opts.orderDir === "desc") ? "DESC" : "ASC";

    const { whereSql, params } = buildWhere(opts);

    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM ${qid("classification")}
         ${whereSql}
         ORDER BY ${orderBy} ${orderDir}
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    );

    const [cntRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt
         FROM ${qid("classification")}
         ${whereSql}`,
        params
    );

    const total = Number((cntRows as any)[0]?.cnt ?? 0);
    return {
        data: rows as unknown as Classification[],
        meta: {
            page, pageSize, total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            orderBy: orderByRaw,
            orderDir: orderDir.toLowerCase() as "asc" | "desc"
        }
    };
}

// Latest sequence within the chosen dataset (virtual vs real)
export async function getLatestSequence(season_id: number, league_id: number, isVirtual: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT MAX(${qid("sequence")}) AS latest
         FROM ${qid("classification")}
         WHERE ${qid("season_id")} = ? AND ${qid("league_id")} = ?
               ${whereForVirtual(isVirtual)}`,
        [season_id, league_id]
    );
    return Number((rows as any)[0]?.latest ?? 0);
}

/** Current standings with prev_seed + movement (no duplication of column lists) */
export async function getCurrentStandings(season_id: number, league_id: number, isVirtual: boolean) {
    const latest = await getLatestSequence(season_id, league_id, isVirtual);
    if (!latest) return { sequence: 0, rows: [] as Classification[] };

    const prev = latest - 1;

    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT
      c.${qid("season_id")}, c.${qid("league_id")}, c.${qid("user_id")}, c.${qid("question_id")},
      c.${qid("points")}, c.${qid("score")}, c.${qid("sequence")}, c.${qid("seed")},
      c.${qid("virtual")}, c.${qid("insertion")}, c.${qid("changed")}, c.${qid("score_ball")},
      p.${qid("seed")} AS prev_seed,
      CASE
        WHEN p.${qid("seed")} IS NULL THEN NULL
        ELSE CAST(CAST(p.${qid("seed")} AS SIGNED) - CAST(c.${qid("seed")} AS SIGNED) AS SIGNED)
      END AS movement
    FROM ${qid("classification")} c
    LEFT JOIN ${qid("classification")} p
      ON p.${qid("season_id")} = c.${qid("season_id")}
     AND p.${qid("league_id")} = c.${qid("league_id")}
     AND p.${qid("user_id")}   = c.${qid("user_id")}
     AND p.${qid("sequence")}  = ?
     AND (
          (c.${qid("virtual")} IS NULL AND p.${qid("virtual")} IS NULL) OR
          (c.${qid("virtual")} = p.${qid("virtual")})
         )
    WHERE c.${qid("season_id")} = ?
      AND c.${qid("league_id")} = ?
      AND c.${qid("sequence")}  = ?
        ${whereForVirtual(isVirtual, "c")}
    ORDER BY c.${qid("seed")} ASC, c.${qid("score")} DESC, c.${qid("points")} DESC
    `,
        [prev, season_id, league_id, latest]
    );

    return { sequence: latest, rows: rows as unknown as Classification[] };
}

/** Standings at a given sequence with prev_seed + movement */
export async function getStandingsAtSequence(season_id: number, league_id: number, sequence: number, isVirtual: boolean) {
    const prev = sequence - 1;

    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT
      c.${qid("season_id")}, c.${qid("league_id")}, c.${qid("user_id")}, c.${qid("question_id")},
      c.${qid("points")}, c.${qid("score")}, c.${qid("sequence")}, c.${qid("seed")},
      c.${qid("virtual")}, c.${qid("insertion")}, c.${qid("changed")}, c.${qid("score_ball")},
      p.${qid("seed")} AS prev_seed,
      CASE
        WHEN p.${qid("seed")} IS NULL THEN NULL
        ELSE CAST(CAST(p.${qid("seed")} AS SIGNED) - CAST(c.${qid("seed")} AS SIGNED) AS SIGNED)
      END AS movement
    FROM ${qid("classification")} c
    LEFT JOIN ${qid("classification")} p
      ON p.${qid("season_id")} = c.${qid("season_id")}
     AND p.${qid("league_id")} = c.${qid("league_id")}
     AND p.${qid("user_id")}   = c.${qid("user_id")}
     AND p.${qid("sequence")}  = ?
     AND (
          (c.${qid("virtual")} IS NULL AND p.${qid("virtual")} IS NULL) OR
          (c.${qid("virtual")} = p.${qid("virtual")})
         )
    WHERE c.${qid("season_id")} = ?
      AND c.${qid("league_id")} = ?
      AND c.${qid("sequence")}  = ?
        ${whereForVirtual(isVirtual, "c")}
    ORDER BY c.${qid("seed")} ASC, c.${qid("score")} DESC, c.${qid("points")} DESC
    `,
        [prev, season_id, league_id, sequence]
    );

    return rows as unknown as Classification[];
}

export async function getUserProgression(season_id: number, league_id: number, user_id: number, isVirtual: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${qid("sequence")}, ${qid("seed")} AS seat, ${qid("score")}, ${qid("points")}
         FROM ${qid("classification")}
         WHERE ${qid("season_id")} = ? AND ${qid("league_id")} = ? AND ${qid("user_id")} = ?
               ${whereForVirtual(isVirtual)}
         ORDER BY ${qid("sequence")} ASC`,
        [season_id, league_id, user_id]
    );
    return rows as unknown as Array<{ sequence: number; seat: number; score: number | null; points: number | null }>;
}

export async function getLeagueTrend(season_id: number, league_id: number, from: number, to: number, isVirtual: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM ${qid("classification")}
         WHERE ${qid("season_id")} = ? AND ${qid("league_id")} = ? AND ${qid("sequence")} BETWEEN ? AND ?
               ${whereForVirtual(isVirtual)}
         ORDER BY ${qid("sequence")} ASC, ${qid("seed")} ASC`,
        [season_id, league_id, from, to]
    );
    return rows as unknown as Classification[];
}