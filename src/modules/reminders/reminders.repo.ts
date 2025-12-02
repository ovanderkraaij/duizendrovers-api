// src/modules/reminders/reminders.repo.ts
import type { RowDataPacket } from "mysql2";
import { pool } from "../../db";

export interface ReminderRunRow {
    id: number;
    runStartedAt: Date;
    runEndedAt: Date;
    payload: any;
    status: string;
}

export interface ReminderBetRow {
    id: number;
    label: string;
    deadline: Date | null;
}

export interface ReminderKoQuestionRow {
    id: number;
    koBetId: number;
    label: string;
    deadline: Date | null;
}

export interface ReminderUserContact {
    userId: number;
    email: string | null;
    deviceToken: string | null;
}

/**
 * Insert a single reminder_runs row at the end of a run.
 * `payload` is stored as JSON (stringified on the way in).
 */
export async function insertReminderRunRow(input: {
    runStartedAt: Date;
    runEndedAt: Date;
    payload: any;
    status: string;
}): Promise<number> {
    const [res] = await pool.execute(
        `
      INSERT INTO reminder_runs (run_started_at, run_ended_at, payload, status)
      VALUES (?, ?, ?, ?)
    `,
        [
            input.runStartedAt,
            input.runEndedAt,
            JSON.stringify(input.payload ?? {}),
            input.status,
        ]
    );

    const result: any = res;
    return Number(result.insertId);
}

/**
 * List reminder_runs rows with optional filters:
 * - sinceDate: only rows with run_started_at >= sinceDate (YYYY-MM-DD)
 * - limit: max number of rows (default 50)
 */
export async function listReminderRuns(params: {
    sinceDate?: string;
    limit?: number;
}): Promise<ReminderRunRow[]> {
    const limit = params.limit && params.limit > 0 && params.limit <= 500 ? params.limit : 50;

    const where: string[] = [];
    const args: any[] = [];

    if (params.sinceDate) {
        where.push("run_started_at >= ?");
        args.push(params.sinceDate);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        id,
        run_started_at    AS runStartedAt,
        run_ended_at      AS runEndedAt,
        payload,
        status
      FROM reminder_runs
      ${whereSql}
      ORDER BY run_started_at DESC, id DESC
      LIMIT ${limit}
    `,
        args
    );

    return (rows as any[]).map((r) => ({
        id: Number(r.id),
        runStartedAt: new Date(r.runStartedAt),
        runEndedAt: new Date(r.runEndedAt),
        payload: safeParseJson(r.payload),
        status: String(r.status ?? ""),
    }));
}

/* -------------------------------------------------------------------------- */
/* Opening candidates                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Bets needing an "opening" notification:
 * - notification = 0
 * - active = '1'
 * - closed = '0'
 * - season.closed = '0' (only current/open seasons)
 */
export async function getBetsNeedingOpening(): Promise<ReminderBetRow[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        b.id,
        b.label,
        b.deadline
      FROM bet b
      JOIN season s ON s.id = b.season_id
      WHERE b.notification = 0
        AND b.active = '1'
        AND s.closed = '0'
        AND b.deadline IS NOT NULL
      ORDER BY b.deadline ASC, b.id ASC
    `
    );

    return (rows as any[]).map((r) => ({
        id: Number(r.id),
        label: String(r.label ?? ""),
        deadline: r.deadline ? new Date(r.deadline) : null,
    }));
}

/**
 * KO questions needing an "opening" notification:
 * - ko_question.notification = 0
 * - ko_question.closed = '0'
 * - parent ko_bet.active = '1'
 * - parent ko_bet.closed = '0'
 */
export async function getKoQuestionsNeedingOpening(): Promise<ReminderKoQuestionRow[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        kq.id,
        kq.ko_bet_id AS koBetId,
        kq.label,
        kq.deadline
      FROM ko_question kq
      JOIN ko_bet kb ON kb.id = kq.ko_bet_id
      WHERE kq.notification = 0
        AND kq.closed = '0'
        AND kb.active = '1'
        AND kb.closed = '0'
      ORDER BY kq.deadline ASC, kq.id ASC
    `
    );

    return (rows as any[]).map((r) => ({
        id: Number(r.id),
        koBetId: Number(r.koBetId),
        label: String(r.label ?? ""),
        deadline: r.deadline ? new Date(r.deadline) : null,
    }));
}

/* -------------------------------------------------------------------------- */
/* Deadline (same-day) candidates                                             */
/* -------------------------------------------------------------------------- */

/**
 * Bets whose deadline is today (Amsterdam time), still active and not closed.
 * - independent of notification flag.
 */
export async function getBetsWithDeadlineToday(): Promise<ReminderBetRow[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        b.id,
        b.label,
        b.deadline
      FROM bet b
      JOIN season s ON s.id = b.season_id
      WHERE b.active = '1'
        AND s.closed = '0'
        AND b.deadline IS NOT NULL
        AND DATE(b.deadline) = CURRENT_DATE()
      ORDER BY b.deadline ASC, b.id ASC
    `
    );

    return (rows as any[]).map((r) => ({
        id: Number(r.id),
        label: String(r.label ?? ""),
        deadline: r.deadline ? new Date(r.deadline) : null,
    }));
}

/**
 * KO questions whose deadline is today (Amsterdam time), still open.
 * - parent ko_bet must be active & not closed.
 */
export async function getKoQuestionsWithDeadlineToday(): Promise<ReminderKoQuestionRow[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        kq.id,
        kq.ko_bet_id AS koBetId,
        kq.label,
        kq.deadline
      FROM ko_question kq
      JOIN ko_bet kb ON kb.id = kq.ko_bet_id
      WHERE kq.closed = '0'
        AND kb.active = '1'
        AND kb.closed = '0'
        AND kq.deadline IS NOT NULL
        AND DATE(kq.deadline) = CURRENT_DATE()
      ORDER BY kq.deadline ASC, kq.id ASC
    `
    );

    return (rows as any[]).map((r) => ({
        id: Number(r.id),
        koBetId: Number(r.koBetId),
        label: String(r.label ?? ""),
        deadline: r.deadline ? new Date(r.deadline) : null,
    }));
}

/* -------------------------------------------------------------------------- */
/* User selection (no answers yet)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Users who should receive a notification for a bet:
 * - Part of the bet's season (users_season).
 * - Have NOT answered any question in that bet (no posted=1 answer).
 * - Returns email + latest enabled device token (if any).
 */
export async function getUsersNeedingNotificationForBet(
    betId: number
): Promise<ReminderUserContact[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        u.id AS userId,
        u.email AS email,
        (
          SELECT dt.token
          FROM device_tokens dt
          WHERE dt.user_id = u.id
            AND dt.enabled = 1
          ORDER BY dt.updated_at DESC
          LIMIT 1
        ) AS deviceToken
      FROM bet b
      JOIN users_season us ON us.season_id = b.season_id
      JOIN users u ON u.id = us.user_id
      WHERE b.id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM question q
          JOIN answer a ON a.question_id = q.id
          WHERE q.bet_id = b.id
            AND a.user_id = u.id
            AND a.posted = '1'
        )
    `,
        [betId]
    );

    return (rows as any[]).map((r) => ({
        userId: Number(r.userId),
        email: r.email ? String(r.email) : null,
        deviceToken: r.deviceToken ? String(r.deviceToken) : null,
    }));
}

/**
 * Users who should receive a notification for a KO question:
 * - Part of the same season as the parent ko_bet (users_season).
 * - Have NOT answered the KO question (no posted=1 ko_answer).
 * - Returns email + latest enabled device token (if any).
 */
export async function getUsersNeedingNotificationForKoQuestion(
    koQuestionId: number
): Promise<ReminderUserContact[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `
      SELECT
        u.id AS userId,
        u.email AS email,
        (
          SELECT dt.token
          FROM device_tokens dt
          WHERE dt.user_id = u.id
            AND dt.enabled = 1
          ORDER BY dt.updated_at DESC
          LIMIT 1
        ) AS deviceToken
      FROM ko_question kq
      JOIN ko_bet kb ON kb.id = kq.ko_bet_id
      JOIN users_season us ON us.season_id = kb.season_id
      JOIN users u ON u.id = us.user_id
      WHERE kq.id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM ko_answer ka
          WHERE ka.ko_question_id = kq.id
            AND ka.user_id = u.id
            AND ka.posted = '1'
        )
    `,
        [koQuestionId]
    );

    return (rows as any[]).map((r) => ({
        userId: Number(r.userId),
        email: r.email ? String(r.email) : null,
        deviceToken: r.deviceToken ? String(r.deviceToken) : null,
    }));
}

/* -------------------------------------------------------------------------- */
/* Mark as opened                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mark a list of bet IDs as opened:
 * - opened = now
 * - notification = 1
 */
export async function markBetsOpened(betIds: number[], now: Date): Promise<void> {
    if (!betIds.length) return;

    const placeholders = betIds.map(() => "?").join(",");
    const params: any[] = [now, ...betIds];

    await pool.execute(
        `
      UPDATE bet
      SET opened = ?, notification = 1
      WHERE id IN (${placeholders})
    `,
        params
    );
}

/**
 * Mark a list of KO question IDs as opened:
 * - opened = now
 * - notification = 1
 */
export async function markKoQuestionsOpened(koQuestionIds: number[], now: Date): Promise<void> {
    if (!koQuestionIds.length) return;

    const placeholders = koQuestionIds.map(() => "?").join(",");
    const params: any[] = [now, ...koQuestionIds];

    await pool.execute(
        `
      UPDATE ko_question
      SET opened = ?, notification = 1
      WHERE id IN (${placeholders})
    `,
        params
    );
}

function safeParseJson(raw: unknown): any {
    if (raw == null) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

