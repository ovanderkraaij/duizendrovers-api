// src/modules/preclassification/preclassification.repo.ts
import { Pool } from 'mysql2/promise';

export class PreclassificationRepo {
    constructor(private pool: Pool) {}

    /** Latest sequence for a bet (null if none). */
    async getMaxSequence(betId: number): Promise<number | null> {
        const [rows] = await this.pool.execute(
            `SELECT MAX(sequence) AS ms
             FROM preclassification
             WHERE bet_id = ?`,
            [betId]
        );
        const r = (rows as any[])[0];
        const ms = r?.ms;
        return ms == null ? null : Number(ms);
    }

    /** Delete all rows older than the sequence we keep. */
    async deleteOlderSequences(betId: number, keepSequence: number | null): Promise<void> {
        if (keepSequence == null) return;
        await this.pool.execute(
            `DELETE FROM preclassification
             WHERE bet_id = ? AND sequence < ?`,
            [betId, keepSequence]
        );
    }

    /** Insert a single preclassification row. */
    async insertRow(
        betId: number,
        userId: number,
        points: number,
        sequence: number,
        seed: number,
        _insertion_iso: string // kept for API compat, value is written via NOW()
    ): Promise<void> {
        await this.pool.execute(
            `INSERT INTO preclassification (bet_id, user_id, points, sequence, seed, insertion)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [betId, userId, points, sequence, seed]
        );
    }

    /**
     * Aggregate users' totals for a bet using SUM(answer.points / question.average)
     * over posted answers only, ordered for seeding.
     */
    async aggregateTotals(betId: number): Promise<Array<{ totalpoints: number; userId: number }>> {
        const [rows] = await this.pool.execute(
            `SELECT
                 SUM(a.points / q.average) AS totalpoints,
                 a.user_id                 AS userId
             FROM answer a
                      INNER JOIN question q ON a.question_id = q.id
             WHERE q.bet_id = ?
               AND a.posted = '1'
             GROUP BY a.user_id
             ORDER BY totalpoints DESC, userId ASC`,
            [betId]
        );
        return (rows as any[]).map(r => ({
            totalpoints: Number(r.totalpoints ?? 0),
            userId: Number(r.userId),
        }));
    }

    /**
     * Optional helper: latest and previous sequence numbers.
     * Not required by the current service, but kept available.
     */
    async get_latest_two_sequences(bet_id: number): Promise<{ latest: number | null; previous: number | null }> {
        const [rows] = await this.pool.query(
            `
                SELECT
                    MAX(sequence) AS latest,
                    (
                        SELECT MAX(sequence)
                        FROM preclassification
                        WHERE bet_id = ?
                          AND sequence < MAX(p.sequence)
                    ) AS previous
                FROM preclassification p
                WHERE p.bet_id = ?
            `,
            [bet_id, bet_id]
        );
        const r = (rows as any[])[0] || {};
        return {
            latest: r.latest != null ? Number(r.latest) : null,
            previous: r.previous != null ? Number(r.previous) : null,
        };
    }

    /**
     * Fetch rows for a specific sequence.
     */
    async get_rows_for_sequence(
        bet_id: number,
        sequence: number
    ): Promise<Array<{ user_id: number; points: number; seed: number }>> {
        const [rows] = await this.pool.query(
            `
                SELECT user_id, points, seed
                FROM preclassification
                WHERE bet_id = ? AND sequence = ?
                ORDER BY seed ASC
            `,
            [bet_id, sequence]
        );
        return rows as Array<{ user_id: number; points: number; seed: number }>;
    }

    /**
     * Latest rows + movement (prev_seed - current_seed) + optional nested user fields.
     * Uses CAST(... AS SIGNED) to avoid unsigned underflow errors.
     */
    async fetchLatestWithMovementAndUser(betId: number): Promise<
        Array<{
            user_id: number;
            seed: number;
            prev_seed: number | null;
            movement: number;
            points: number;
            user: { id: number; firstname: string | null; infix: string | null; lastname: string | null };
        }>
        > {
        const [rows] = await this.pool.query(
            `
                SELECT
                    p.user_id,
                    p.seed,
                    p.points,
                    prev.seed AS prev_seed,
                    CASE
                        WHEN prev.seed IS NULL THEN 0
                        ELSE CAST(prev.seed AS SIGNED) - CAST(p.seed AS SIGNED)
                        END AS movement,
                    u.id        AS u_id,
                    u.firstname AS u_firstname,
                    u.infix     AS u_infix,
                    u.lastname  AS u_lastname
                FROM preclassification p
                         LEFT JOIN preclassification prev
                                   ON prev.bet_id = p.bet_id
                                       AND prev.sequence = p.sequence - 1
                                       AND prev.user_id = p.user_id
                         LEFT JOIN users u
                                   ON u.id = p.user_id
                WHERE p.bet_id = ?
                  AND p.sequence = (SELECT MAX(sequence) FROM preclassification WHERE bet_id = p.bet_id)
                ORDER BY p.seed ASC
            `,
            [betId]
        );

        return (rows as any[]).map(r => ({
            user_id: Number(r.user_id),
            seed: Number(r.seed),
            prev_seed: r.prev_seed != null ? Number(r.prev_seed) : null,
            movement: Number(r.movement ?? 0),
            points: Number(r.points ?? 0),
            user: {
                id: Number(r.u_id ?? r.user_id),
                firstname: r.u_firstname ?? null,
                infix: r.u_infix ?? null,
                lastname: r.u_lastname ?? null,
            },
        }));
    }

    /** Small helper to fetch the bet title for the AppBar. */
    async getBetLabel(betId: number): Promise<string | null> {
        const [rows] = await this.pool.query(
            `SELECT label FROM bet WHERE id = ? LIMIT 1`,
            [betId]
        );
        const r = (rows as any[])[0];
        return r?.label ?? null;
    }

    // ─────────────────────────────── NEW: helpers for counts & not_submitted ───────────────────────────────

    /** Season that owns this bet. */
    async getBetSeasonId(betId: number): Promise<number | null> {
        const [rows] = await this.pool.query(`SELECT season_id FROM bet WHERE id = ? LIMIT 1`, [betId]);
        const r = (rows as any[])[0];
        const sid = r?.season_id;
        return sid == null ? null : Number(sid);
    }

    /** All participants for a season (universe). */
    async listSeasonParticipants(seasonId: number): Promise<Array<{ user_id: number; firstname: string | null; infix: string | null; lastname: string | null }>> {
        const [rows] = await this.pool.query(
            `
      SELECT u.id AS user_id, u.firstname, u.infix, u.lastname
      FROM users_season us
      JOIN users u ON u.id = us.user_id
      WHERE us.season_id = ?
      `,
            [seasonId]
        );
        return (rows as any[]).map(r => ({
            user_id: Number(r.user_id),
            firstname: r.firstname ?? null,
            infix: r.infix ?? null,
            lastname: r.lastname ?? null,
        }));
    }

    /** Distinct user_ids who have posted at least one answer in this bet. */
    async listSubmittedUserIdsForBet(betId: number): Promise<Set<number>> {
        const [rows] = await this.pool.query(
            `
      SELECT DISTINCT a.user_id AS user_id
      FROM answer a
      JOIN question q ON q.id = a.question_id
      WHERE q.bet_id = ? AND a.posted = '1'
      `,
            [betId]
        );
        const s = new Set<number>();
        for (const r of rows as any[]) s.add(Number(r.user_id));
        return s;
    }

    /** Map user_id -> squad info + captain flag for a season. */
    async mapUserSquadInfo(seasonId: number): Promise<Map<number, { is_captain: boolean; abbr: string | null; bg: string | null; fg: string | null }>> {
        const [rows] = await this.pool.query(
            `
    SELECT su.user_id,
           su.is_captain,
           s.scode   AS abbr,
           s.bgcolor AS bg,
           s.color   AS fg
    FROM squad_users su
    JOIN squad s ON s.id = su.squad_id
    WHERE su.season_id = ?
    `,
            [seasonId]
        );
        const m = new Map<number, { is_captain: boolean; abbr: string | null; bg: string | null; fg: string | null }>();
        for (const r of rows as any[]) {
            m.set(Number(r.user_id), {
                is_captain: String(r.is_captain ?? '') === '1',
                abbr: (r.abbr ?? null),
                bg: (r.bg ?? null),
                fg: (r.fg ?? null),
            });
        }
        return m;
    }}