import type { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { qid, placeholders } from "../data/sql";
import type { Season, League, User, ExpandKey } from "../types/domain";

/**
 * Registry describing how to fetch each domain object by ID.
 * - table: DB table name
 * - columns: extra columns (id is auto-included)
 * - projector: maps a DB row -> typed domain object
 */
const REGISTRY = {
    season: {
        table: "season",
        columns: ["label"] as const,
        projector: (r: any): Season => ({
            id: Number(r.id),
            label: r.label ?? null,
        }),
    },
    league: {
        table: "league",
        columns: ["label"] as const,
        projector: (r: any): League => ({
            id: Number(r.id),
            label: r.label ?? null,
        }),
    },
    user: {
        table: "users",
        columns: ["firstname", "infix", "lastname"] as const,
        projector: (r: any): User => ({
            id: Number(r.id),
            firstname: r.firstname ?? null,
            infix: r.infix ?? null,
            lastname: r.lastname ?? null,
        }),
    },
} as const satisfies Record<
    ExpandKey,
    {
        table: string;
        columns: readonly string[];
        projector: (row: any) => any;
    }
    >;

/** ---- tiny in-memory cache with TTL ---- */
type Entry<T> = { at: number; data: Map<number, T> };
const TTL_MS = 60_000;
const cache: Record<string, Entry<any>> = {};

function getCached<T>(key: string): Map<number, T> | null {
    const e = cache[key];
    if (!e) return null;
    if (Date.now() - e.at > TTL_MS) return null;
    return e.data as Map<number, T>;
}
function setCached<T>(key: string, data: Map<number, T>) {
    cache[key] = { at: Date.now(), data };
}

/**
 * Generic fetcher for any ExpandKey (season | league | user)
 * Returns a Map<id, DomainObject> suitable for enrichment.
 */
export async function getLookupMap<K extends ExpandKey>(
    key: K,
    ids: number[]
): Promise<Map<number, K extends "season" ? Season : K extends "league" ? League : User>> {
    const unique = Array.from(new Set(ids)).filter((n) => Number.isFinite(n));
    if (unique.length === 0) return new Map();

    const reg = REGISTRY[key];
    const cacheKey = `${key}:${unique.sort((a, b) => a - b).join(",")}`;
    const cached = getCached<typeof reg.projector extends (r: any) => infer T ? T : never>(cacheKey);
    if (cached) return cached as any;

    const selectCols = ["id", ...reg.columns].map((c) => qid(c)).join(", ");
    const sql = `SELECT ${selectCols} FROM ${qid(reg.table)} WHERE ${qid("id")} IN (${placeholders(unique.length)})`;
    const [rows] = await pool.query<RowDataPacket[]>(sql, unique);

    const map = new Map<number, any>();
    for (const r of rows) {
        const obj = reg.projector(r);
        map.set(obj.id, obj);
    }

    setCached(cacheKey, map);
    return map as any;
}

/** Convenience wrappers (optional; use getLookupMap directly if you prefer) */
export const mapSeasons = (ids: number[]) => getLookupMap("season", ids);
export const mapLeagues = (ids: number[]) => getLookupMap("league", ids);
export const mapUsers   = (ids: number[]) => getLookupMap("user", ids);

/** Optional: a display helper if you want a ready-made full name */
export function userDisplayName(u: User | null | undefined) {
    if (!u) return "";
    const parts = [u.firstname, u.infix, u.lastname].filter(Boolean);
    return parts.join(" ");
}