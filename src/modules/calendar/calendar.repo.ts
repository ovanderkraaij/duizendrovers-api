// src/modules/calendar/calendar.repo.ts
import { pool } from "../../db";

export type DbEvent = {
    id: number;
    season_id: number;
    label: string;
    deadline: string | Date | null;
    expected: string | Date | null;
    active: number;   // 1/0
    virtual: number;  // 1/0  (deprecated at bet-level; still forwarded)
    sport_id: number | null;

    // NEW: 1/0 from EXISTS(...) subqueries
    has_solution: number;
    virtual_any_main: number; // ← NEW
};

/**
 * Consistent ordering:
 *  1. Events that have a real or expected date first
 *  2. By earliest (real → expected)
 *  3. Then alphabetically by label / id
 */
const ORDER_BY_EFFECTIVE = `
  ORDER BY
    CASE WHEN bet.deadline IS NULL AND bet.expected IS NULL THEN 1 ELSE 0 END ASC,
    COALESCE(bet.deadline, bet.expected) ASC,
    bet.label ASC,
    bet.id ASC
`;

/**
 * Fetch all events for the open (non-closed) season.
 * Fully qualify columns to avoid collisions with season.* fields.
 */
export async function fetchOpenSeasonEvents(): Promise<DbEvent[]> {
    const [rows] = await pool.query<DbEvent[]>(
        `
    SELECT
      bet.id,
      bet.season_id,
      bet.label,
      bet.deadline AS deadline,
      bet.expected AS expected,
      bet.active,
      bet.virtual,
      bet.sport_id,

      /* NEW: at least one question under this bet has a solution row */
      EXISTS (
        SELECT 1
        FROM question q
        JOIN solution s ON s.question_id = q.id
        WHERE q.bet_id = bet.id
        LIMIT 1
      ) AS has_solution,

      /* NEW: any MAIN question (question_id IS NULL) is virtual='1' */
      EXISTS (
        SELECT 1
        FROM question qv
        WHERE qv.bet_id = bet.id
          AND qv.question_id IS NULL
          AND qv.virtual = '1'
        LIMIT 1
      ) AS virtual_any_main

    FROM bet
    INNER JOIN season s ON s.id = bet.season_id
    WHERE s.closed = 0
    ${ORDER_BY_EFFECTIVE}
    `
    );
    return rows;
}

/**
 * Fetch all events for a specific season.
 * Uses the same explicit aliasing and ordering.
 */
export async function fetchEventsBySeason(seasonId: number): Promise<DbEvent[]> {
    const [rows] = await pool.query<DbEvent[]>(
        `
    SELECT
      bet.id,
      bet.season_id,
      bet.label,
      bet.deadline AS deadline,
      bet.expected AS expected,
      bet.active,
      bet.virtual,
      bet.sport_id,

      /* NEW: at least one question under this bet has a solution row */
      EXISTS (
        SELECT 1
        FROM question q
        JOIN solution s ON s.question_id = q.id
        WHERE q.bet_id = bet.id
        LIMIT 1
      ) AS has_solution,

      /* NEW: any MAIN question (question_id IS NULL) is virtual='1' */
      EXISTS (
        SELECT 1
        FROM question qv
        WHERE qv.bet_id = bet.id
          AND qv.question_id IS NULL
          AND qv.virtual = '1'
        LIMIT 1
      ) AS virtual_any_main

    FROM bet
    WHERE bet.season_id = ?
    ${ORDER_BY_EFFECTIVE}
    `,
        [seasonId]
    );
    return rows;
}