// src/modules/users/users.repo.ts
import type { RowDataPacket } from "mysql2";
import { pool } from "../../db";

/**
 * Low-level users repo functions.
 * Follows the same pattern as squads.repo.ts:
 * - import shared pool
 * - export async functions
 */

export async function listBySeason(seasonId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT u.id, u.firstname, u.infix, u.lastname, u.email
      FROM users_season us
      JOIN users u ON u.id = us.user_id
      WHERE us.season_id = ?
      ORDER BY u.firstname, u.lastname
      `,
        [seasonId]
    );
    return rows as any[];
}

export async function getUserById(userId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT u.id, u.firstname, u.infix, u.lastname, u.email
      FROM users u
      WHERE u.id = ?
      LIMIT 1
      `,
        [userId]
    );
    const arr = rows as any[];
    return arr.length > 0 ? arr[0] : null;
}