// src/modules/seasons/seasons.repo.ts
import { Pool } from "mysql2/promise";

export interface SeasonRow {
    id: number;
    label: string;
    closed: number | null; // 1/0 or null in DB
}

export interface LeagueRow {
    id: number;
    label: string;
    icon: string | null;
}

export class SeasonsRepo {
    constructor(private pool: Pool) {}

    async getSeasons(): Promise<SeasonRow[]> {
        const [rows] = await this.pool.query(
            `
      SELECT id, label, closed
      FROM season
      ORDER BY id DESC
      `
        );
        return rows as SeasonRow[];
    }

    async getLeaguesBySeason(seasonId: number): Promise<LeagueRow[]> {
        const [rows] = await this.pool.query(
            `
      SELECT l.id, l.label, COALESCE(l.icon, '') AS icon
      FROM league l
      JOIN classification c
        ON c.league_id = l.id
      WHERE c.season_id = ?
      GROUP BY l.id, l.label, l.icon
      ORDER BY l.id ASC
      `,
            [seasonId]
        );
        return rows as LeagueRow[];
    }

    /**
     * Per-group (bundle) totals for a bet+user.
     * - value:  SUM(answer.points) over posted answers in the group
     * - score:  SUM(answer.score)  over posted answers in the group
     * Subs (points=0) naturally contribute 0; bonuses contribute their own points.
     */
    async getGroupTotals(
        betId: number,
        userId: number
    ): Promise<Array<{ group_code: number; value: number; score: number }>> {
        const [rows] = await this.pool.query(
            `
      SELECT
        q.groupcode AS group_code,
        SUM(a.points) AS value,
        SUM(a.score)  AS score
      FROM answer a
      JOIN question q ON q.id = a.question_id
      WHERE q.bet_id = ? AND a.user_id = ? AND a.posted = '1'
      GROUP BY q.groupcode
      ORDER BY MIN(q.lineup) ASC, q.groupcode ASC
      `,
            [betId, userId]
        );
        return (rows as any[]).map((r) => ({
            group_code: Number(r.group_code),
            value: Number(r.value ?? 0),
            score: Number(r.score ?? 0),
        }));
    }
}