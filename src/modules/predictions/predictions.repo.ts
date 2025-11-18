// src/modules/predictions/predictions.repo.ts
import type { Pool, RowDataPacket } from "mysql2/promise";
import { qid, placeholders } from "../../data/sql";

export type AnswerBundleRow = {
    user_id: number;
    question_id: number;
    value: number;        // a.points
    actual: number;       // a.score
    gray: string;         // '0' | '1'
    correct: string;      // '0' | '1'
    label: string | null;
    listitem_id: number | null;
    result: string | null; // ← NEW: canonical result used for grouping/sorting

    firstname: string | null;
    infix: string | null;
    lastname: string | null;
};

export class PredictionsRepo {
    constructor(private pool: Pool) {}

    /**
     * Posted answers for a set of question_ids, joined with users for display_name parts.
     */
    async getAnswersForBundle(qids: number[]): Promise<AnswerBundleRow[]> {
        if (!qids.length) return [];
        const sql = `
      SELECT
        a.${qid("user_id")}       AS user_id,
        a.${qid("question_id")}   AS question_id,
        a.${qid("points")}        AS value,
        a.${qid("score")}         AS actual,
        a.${qid("gray")}          AS gray,
        a.${qid("correct")}       AS correct,
        a.${qid("label")}         AS label,
        a.${qid("listitem_id")}   AS listitem_id,
        a.${qid("result")}        AS result,
        u.${qid("firstname")}     AS firstname,
        u.${qid("infix")}         AS infix,
        u.${qid("lastname")}      AS lastname
      FROM ${qid("answer")} a
      JOIN ${qid("users")} u
        ON u.${qid("id")} = a.${qid("user_id")}
      WHERE a.${qid("posted")} = '1'
        AND a.${qid("question_id")} IN (${placeholders(qids.length)})
    `;
        const [rows] = await this.pool.query<RowDataPacket[]>(sql, qids);
        return (rows as any[]).map((r) => ({
            user_id: Number(r.user_id),
            question_id: Number(r.question_id),
            value: Number(r.value ?? 0),
            actual: Number(r.actual ?? 0),
            gray: String(r.gray ?? "0"),
            correct: String(r.correct ?? "0"),
            label: r.label != null ? String(r.label) : null,
            listitem_id: r.listitem_id == null ? null : Number(r.listitem_id),
            result: r.result != null ? String(r.result) : null,
            firstname: r.firstname ?? null,
            infix: r.infix ?? null,
            lastname: r.lastname ?? null,
        }));
    }
}