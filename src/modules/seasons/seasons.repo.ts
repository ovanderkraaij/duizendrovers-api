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
}