// src/modules/solutions/solutions.repo.ts
import { Pool } from "mysql2/promise";

type Row = Record<string, any>;

export class SolutionsRepo {
    constructor(public readonly pool: Pool) {}

    async addSolution(questionId: number, result: string, listItemId: number | null) {
        await this.pool.execute(
            `INSERT INTO solution (question_id, result, listitem_id) VALUES (?, ?, ?)`,
            [questionId, result, listItemId]
        );
    }

    /**
     * Reset correctness/score for the bet.
     * - Posted rows: always reset.
     * - Margin rows: reset even if NOT posted (so we can mark the single correct variant).
     */
    async resetCorrectAndScoreForBet(betId: number) {
        await this.pool.execute(
            `
                UPDATE answer a
                    JOIN question q ON q.id = a.question_id
                    SET a.correct = '0', a.score = 0
                WHERE q.bet_id = ?
                  AND (a.posted = '1' OR (q.margin IS NOT NULL AND q.step IS NOT NULL))
            `,
            [betId]
        );
    }

    // --- Read: mains for a bet (root questions)
    async getMainQuestionsForBet(betId: number) {
        const [rows] = await this.pool.execute(
            `
                SELECT id, groupcode, points, margin, step, resulttype_id
                FROM question
                WHERE bet_id = ? AND question_id IS NULL
                ORDER BY id
            `,
            [betId]
        );
        return rows as Row[];
    }

    // --- Read: full group by groupcode (includes main + subs + bonuses)
    async getGroupQuestions(groupcode: number) {
        const [rows] = await this.pool.execute(
            `
                SELECT id, points, resulttype_id, margin, step
                FROM question
                WHERE groupcode = ?
                ORDER BY lineup
            `,
            [groupcode]
        );
        return rows as Row[];
    }

    // --- Read: resulttype labels for a set of qids + margins
    async getResulttypesForQids(qids: number[]) {
        if (!qids.length) return [] as Row[];
        const [rows] = await this.pool.query(
            `
                SELECT
                    q.id AS qid,
                    LOWER(rt.label) AS rt_label,
                    q.margin AS q_margin,
                    q.step   AS q_step
                FROM question q
                         JOIN resulttype rt ON rt.id = q.resulttype_id
                WHERE q.id IN (${qids.map(() => "?").join(",")})
            `,
            qids
        );
        return rows as Row[];
    }

    // --- Read: solutions (official) for a set of qids
    async getSolutionsForQids(qids: number[]) {
        if (!qids.length) return [] as Row[];
        const [rows] = await this.pool.query(
            `
                SELECT question_id, result, listitem_id
                FROM solution
                WHERE question_id IN (${qids.map(() => "?").join(",")})
            `,
            qids
        );
        return rows as Row[];
    }

    // --- Read: posted answers for a whole bet (used for singles/bundles/bonuses)
    async getPostedAnswersForBet(betId: number) {
        const [rows] = await this.pool.execute(
            `
                SELECT a.id,
                       a.user_id,
                       a.question_id,
                       a.result,
                       a.label,
                       a.listitem_id,
                       a.points AS answer_points, -- per-user, equalized points
                       q.groupcode,
                       q.points AS question_points,
                       q.margin,
                       q.step
                FROM answer a
                         JOIN question q ON q.id = a.question_id
                WHERE q.bet_id = ?
                  AND a.posted = '1'
            `,
            [betId]
        );
        return rows as Row[];
    }

    // --- Read: ALL answers (posted + unposted) for a set of qids within a bet (used for margin)
    async getAllAnswersForQidsInBet(betId: number, qids: number[]) {
        if (!qids.length) return [] as Row[];
        const [rows] = await this.pool.query(
            `
      SELECT a.id,
             a.user_id,
             a.question_id,
             a.result,
             a.label,
             a.listitem_id,
             a.gray,
             a.points AS answer_points,
             a.score  AS answer_score,
             a.posted
      FROM answer a
      JOIN question q ON q.id = a.question_id
      WHERE q.bet_id = ?
        AND q.id IN (${qids.map(() => "?").join(",")})
      `,
            [betId, ...qids]
        );
        return rows as Row[];
    }

    /**
     * Batch update by ANSWER ID (precise; needed for margin variants).
     * The caller decides which ids to include (posted or not).
     */
    async batchUpdateCorrectScoreByAnswerId(
        updates: Array<{ answerId: number; correct: 0 | 1; score: number }>
    ) {
        if (!updates.length) return;
        const CHUNK = 500;
        for (let i = 0; i < updates.length; i += CHUNK) {
            const chunk = updates.slice(i, i + CHUNK);
            const params: any[] = [];
            let sql = `
        UPDATE answer AS a
        JOIN (
      `;
            sql += chunk
                .map(() => `SELECT ? AS id, ? AS correct, ? AS score`)
                .join(" UNION ALL ");
            sql += `
        ) AS t ON t.id = a.id
        SET a.correct = t.correct, a.score = t.score
      `;
            for (const u of chunk) params.push(u.answerId, u.correct, u.score);
            await this.pool.execute(sql, params);
        }
    }

    // --- Legacy helpers (unchanged)
    async getChildrenForMain(mainId: number) {
        const [rows] = await this.pool.execute(
            `SELECT id, points FROM question WHERE question_id = ? ORDER BY lineup`,
            [mainId]
        );
        return rows as Row[];
    }

    async markMainCorrect(mainId: number) {
        await this.pool.execute(
            `
                UPDATE answer a
                    JOIN solution s ON s.question_id = a.question_id
                    SET a.correct = '1', a.score = a.points
                WHERE a.question_id = ? AND a.posted = '1'
                  AND (
                    (a.listitem_id IS NOT NULL AND a.listitem_id = s.listitem_id)
                   OR
                    (a.listitem_id IS NULL AND a.result = s.result)
                    )
            `,
            [mainId]
        );
    }

    async markChildrenCorrectWhenMainCorrect(mainId: number, children: Array<{ id: number }>) {
        if (!children.length) return;
        const idList = children.map(c => c.id);
        await this.pool.query(
            `
                UPDATE answer a
                    JOIN solution s ON s.question_id = a.question_id
                    JOIN (
                    SELECT user_id
                    FROM answer
                    WHERE question_id = ? AND posted = '1' AND correct = '1'
                    ) AS winners ON winners.user_id = a.user_id
                    SET a.correct = '1', a.score = a.points
                WHERE a.question_id IN (${idList.map(() => "?").join(",")})
                  AND a.posted = '1'
                  AND (
                    (a.listitem_id IS NOT NULL AND a.listitem_id = s.listitem_id)
                   OR
                    (a.listitem_id IS NULL AND a.result = s.result)
                    )
            `,
            [mainId, ...idList]
        );
    }
}