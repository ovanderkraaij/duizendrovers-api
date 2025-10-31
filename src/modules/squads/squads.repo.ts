// src/modules/squads/squads.repo.ts
import type { RowDataPacket } from "mysql2";
import { pool } from "../../db";
import { qid } from "../../data/sql";

/** Get the open season (closed = 0). */
export async function getOpenSeasonId(): Promise<number | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${qid("id")} FROM ${qid("season")} WHERE ${qid("closed")} = '0' LIMIT 1`
    );
    const id = (rows as any)[0]?.id;
    return typeof id === "number" ? id : Number(id) || null;
}

/** All squads that have members in the given season. */
export async function getSquadsWithMembers(seasonId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT s.${qid("id")} AS id, s.${qid("label")} AS label, s.${qid("scode")} AS scode,
           s.${qid("color")} AS color, s.${qid("bgcolor")} AS bgcolor
    FROM ${qid("squad")} s
    WHERE EXISTS (
      SELECT 1 FROM ${qid("squad_users")} su
      WHERE su.${qid("season_id")} = ? AND su.${qid("squad_id")} = s.${qid("id")}
    )
    ORDER BY s.${qid("label")} ASC
    `,
        [seasonId]
    );
    return rows as unknown as Array<{ id: number; label: string; scode?: string; color?: string; bgcolor?: string }>;
}

/** Map: squad_id -> members [{user_id, is_captain}] and the global smallest squad size. */
export async function getSeasonSquadMembers(seasonId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT ${qid("squad_id")} AS squad_id,
           ${qid("user_id")}  AS user_id,
           ${qid("is_captain")} AS is_captain
    FROM ${qid("squad_users")}
    WHERE ${qid("season_id")} = ?
    ORDER BY ${qid("squad_id")}, ${qid("user_id")}
    `,
        [seasonId]
    );
    const bySquad = new Map<number, Array<{ user_id: number; is_captain: boolean }>>();
    for (const r of rows as any[]) {
        const sid = Number(r.squad_id);
        const u = Number(r.user_id);
        const cap = String(r.is_captain ?? "") === "1";
        if (!bySquad.has(sid)) bySquad.set(sid, []);
        bySquad.get(sid)!.push({ user_id: u, is_captain: cap });
    }
    // smallest squad size among squads that actually have members
    let minSize = Number.POSITIVE_INFINITY;
    for (const arr of bySquad.values()) {
        if (arr.length > 0) minSize = Math.min(minSize, arr.length);
    }
    if (!Number.isFinite(minSize)) minSize = 0;
    return { bySquad, smallest: minSize };
}

/** Latest sequence for classification dataset (virtual/real). */
export async function getLatestSequence(seasonId: number, leagueId: number, isVirtual: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT MAX(${qid("sequence")}) AS latest
    FROM ${qid("classification")}
    WHERE ${qid("season_id")} = ? AND ${qid("league_id")} = ?
      AND ${isVirtual ? `${qid("virtual")} = '1'` : `(${qid("virtual")} IS NULL OR ${qid("virtual")} = '0' OR ${qid("virtual")} = '')`}
    `,
        [seasonId, leagueId]
    );
    return Number((rows as any)[0]?.latest ?? 0);
}

/**
 * Classification rows at a given sequence (virtual/real):
 * Returns minimal fields needed for squad computation.
 */
export async function getClassRowsAtSequence(seasonId: number, leagueId: number, sequence: number, isVirtual: boolean) {
    if (!sequence) return [] as Array<{ user_id: number; question_id: number; score: number }>;
    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT ${qid("user_id")} AS user_id,
           ${qid("question_id")} AS question_id,
           ${qid("score")} AS score
    FROM ${qid("classification")}
    WHERE ${qid("season_id")} = ? AND ${qid("league_id")} = ? AND ${qid("sequence")} = ?
      AND ${isVirtual ? `${qid("virtual")} = '1'` : `(${qid("virtual")} IS NULL OR ${qid("virtual")} = '0' OR ${qid("virtual")} = '')`}
    `,
        [seasonId, leagueId, sequence]
    );
    // coerce numbers defensively
    return (rows as any[]).map(r => ({
        user_id: Number(r.user_id),
        question_id: Number(r.question_id),
        score: Number(r.score ?? 0),
    }));
}