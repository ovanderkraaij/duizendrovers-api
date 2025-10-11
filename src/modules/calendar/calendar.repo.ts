// src/modules/calendar/calendar.repo.ts
import { pool } from "../../db";

export type DbEvent = {
    id: number;
    season_id: number;
    label: string;
    deadline: string | Date | null;
    active: number;          // 1/0
    virtual: number;         // 1/0
    sport_id: number | null;
};

export async function fetchOpenSeasonEvents(): Promise<DbEvent[]> {
    const [rows] = await pool.query<DbEvent[]>(
        `
    SELECT e.id, e.season_id, e.label, e.deadline, e.active, e.virtual, e.sport_id
    FROM bet e
    JOIN season s ON s.id = e.season_id
    WHERE s.closed = 0
    `
    );
    return rows;
}