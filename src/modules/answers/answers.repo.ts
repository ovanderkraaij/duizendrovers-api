// src/modules/answers/answers.repo.ts
import { Pool } from "mysql2/promise";

export interface CreateAnswerInput {
    questionId: number;
    userId: number;
    result: string;
    label: string;
    posted?: 1 | 0;
    listItemId?: number | null;
}

export class AnswersRepo {
    constructor(public pool: Pool) {}

    async insertAnswer(a: CreateAnswerInput) {
        const sql = `INSERT INTO answer
                     (question_id, user_id, result, label, points, score, correct, posted, eliminated, gray, listitem_id)
                     VALUES (?, ?, ?, ?, 0, 0, '0', ?, '0', '0', ?)`;
        const params = [a.questionId, a.userId, a.result, a.label, a.posted ?? 1, a.listItemId ?? null];
        const [res]: any = await this.pool.execute(sql, params);
        return res.insertId as number;
    }

    async updatePointsForExactResult(questionId: number, result: string, points: number) {
        await this.pool.execute(
            `UPDATE answer SET points=? WHERE question_id=? AND result=?`,
            [points, questionId, result]
        );
    }

    async updatePointsForListItem(questionId: number, listItemId: number, points: number) {
        await this.pool.execute(
            `UPDATE answer SET points=? WHERE question_id=? AND listitem_id=?`,
            [points, questionId, listItemId]
        );
    }

    async getUserPostedAnswer(questionId: number, userId: number) {
        const [rows] = await this.pool.execute(
            `SELECT *
             FROM answer
             WHERE question_id=? AND user_id=? AND posted='1'
             ORDER BY id DESC
             LIMIT 1`,
            [questionId, userId]
        );
        return (rows as any[])[0] ?? null;
    }

    async getAnswersForUserMargin(questionId: number, userId: number) {
        const [rows] = await this.pool.execute(
            `SELECT *
             FROM answer
             WHERE question_id=? AND user_id=?
             ORDER BY CAST(result AS DECIMAL(20,6))`,
            [questionId, userId]
        );
        return rows as any[];
    }

    async countMatchesForResult(questionId: number, result: string) {
        const [rows] = await this.pool.execute(
            `SELECT COUNT(*) as n FROM answer WHERE question_id=? AND result=?`,
            [questionId, result]
        );
        return (rows as any[])[0]?.n ?? 0;
    }

    async countMatchesForListItem(questionId: number, listItemId: number) {
        const [rows] = await this.pool.execute(
            `SELECT COUNT(*) as n FROM answer WHERE question_id=? AND listitem_id=?`,
            [questionId, listItemId]
        );
        return (rows as any[])[0]?.n ?? 0;
    }

    // Recompute simple mains (used by service)
    async recomputeSimpleMainNonListPoints(questionId: number, maxPoints: number) {
        const [variants] = await this.pool.execute(
            `SELECT result, COUNT(*) AS n
             FROM answer
             WHERE question_id = ? AND posted='1'
             GROUP BY result`,
            [questionId]
        );
        for (const v of variants as any[]) {
            const n = Number(v.n);
            const res = String(v.result);
            if (n > 0) {
                const pts = maxPoints / n;
                await this.pool.execute(
                    `UPDATE answer
                     SET points = ?
                     WHERE question_id = ? AND posted='1' AND result = ?`,
                    [pts, questionId, res]
                );
            }
        }
    }

    async recomputeSimpleMainListPoints(questionId: number, maxPoints: number) {
        const [variants] = await this.pool.execute(
            `SELECT listitem_id, COUNT(*) AS n
             FROM answer
             WHERE question_id = ? AND posted='1'
             GROUP BY listitem_id`,
            [questionId]
        );
        for (const v of variants as any[]) {
            const n = Number(v.n);
            const li = v.listitem_id == null ? null : Number(v.listitem_id);
            if (n > 0 && li != null) {
                const pts = maxPoints / n;
                await this.pool.execute(
                    `UPDATE answer
                     SET points = ?
                     WHERE question_id = ? AND posted='1' AND listitem_id = ?`,
                    [pts, questionId, li]
                );
            }
        }
    }
    /** Remove all answers for a user & question (used before re-inserting center + variants). */
    async deleteUserAnswers(questionId: number, userId: number) {
        await this.pool.execute(
            `DELETE FROM answer WHERE question_id = ? AND user_id = ?`,
            [questionId, userId]
        );
    }

    /** Efficient multi-insert for center + derived variants. */
    async insertAnswersMany(rows: Array<CreateAnswerInput>) {
        if (!rows.length) return;
        const sql = `INSERT INTO answer
      (question_id, user_id, result, label, points, score, correct, posted, eliminated, gray, listitem_id)
      VALUES ${rows.map(() => `(?, ?, ?, ?, 0, 0, '0', ?, '0', '0', ?)`).join(',')}`;
        const params: any[] = [];
        for (const r of rows) {
            params.push(r.questionId, r.userId, r.result, r.label, r.posted ?? 1, r.listItemId ?? null);
        }
        await this.pool.execute(sql, params);
    }

    async getPostedForBetUser(betId: number, userId: number) {
        const [rows] = await this.pool.query(
            `
      SELECT a.question_id AS questionId, a.label, a.result, a.listitem_id AS listItemId
      FROM answer a
      JOIN question q ON q.id = a.question_id
      WHERE q.bet_id = ? AND a.user_id = ? AND a.posted = '1'
      ORDER BY q.lineup ASC, a.id DESC
      `,
            [betId, userId]
        );
        return rows as any[];
    }

    /**
     * NEW: all answers (posted + margin variants) for a bet & user.
     * Used by BetsService.getBetBundles to build the per-question user block.
     */
    async getAllForBetUser(betId: number, userId: number) {
        const [rows] = await this.pool.query(
            `
                SELECT
                    a.question_id AS questionId,
                    a.label,
                    a.result,
                    a.listitem_id AS listItemId,
                    a.points,
                    a.score,
                    a.correct,
                    a.posted
                FROM answer a
                         JOIN question q ON q.id = a.question_id
                WHERE q.bet_id = ?
                  AND a.user_id = ?
                ORDER BY q.groupcode ASC, q.lineup ASC, a.id ASC
            `,
            [betId, userId]
        );
        return rows as any[];
    }
}