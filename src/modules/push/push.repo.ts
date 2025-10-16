// src/modules/push/push.repo.ts
import { pool } from "../../db";

export async function upsertDeviceToken(
    userId: number,
    token: string,
    platform: "ios" | "android",
    locale?: string,
    tz?: string
) {
    await pool.query(
        `INSERT INTO device_tokens (user_id, token, platform, locale, tz, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform),
       locale   = VALUES(locale),
       tz       = VALUES(tz),
       enabled  = 1,
       updated_at = NOW()`,
        [userId, token, platform, locale ?? null, tz ?? null]
    );
}

export async function getLatestTokenForUser(userId: number): Promise<string | null> {
    const [rows] = await pool.query(
        `SELECT token
       FROM device_tokens
      WHERE user_id = ? AND enabled = 1
      ORDER BY updated_at DESC
      LIMIT 1`,
        [userId]
    );
    const r = Array.isArray(rows) ? (rows as any[])[0] : null;
    return r?.token ?? null;
}