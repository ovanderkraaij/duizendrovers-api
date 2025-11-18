// src/modules/questions/question.repo.ts
import { Pool } from 'mysql2/promise';

export interface QuestionRow {
    id: number;
    bet_id: number;
    question_id: number | null;
    resulttype_id: number;
    groupcode: number;
    points: number;   // main points; 0 for subs
    margin: number | null;
    step: number | null;
    lineup: number;
    virtual: number;
    average: number;
}

export class QuestionsRepo {
    constructor(public readonly pool: Pool) {}

    // --- Simple in-memory caches to cut roundtrips ---
    private rtLabelById = new Map<number, string>();
    private listItemLabelById = new Map<number, string | null>();

    // -----------------------
    // Existing API
    // -----------------------
    async getMainQuestions(betId: number) {
        const sql = `SELECT * FROM question WHERE bet_id=? AND question_id IS NULL ORDER BY lineup`;
        const [rows] = await this.pool.execute(sql, [betId]);
        return rows as QuestionRow[];
    }

    async getSubs(groupcode: number) {
        const sql = `SELECT * FROM question
               WHERE groupcode=? AND question_id IS NOT NULL AND COALESCE(points,0)=0
               ORDER BY lineup`;
        const [rows] = await this.pool.execute(sql, [groupcode]);
        return rows as QuestionRow[];
    }

    async getBonuses(groupcode: number) {
        const sql = `SELECT * FROM question
               WHERE groupcode=? AND question_id IS NOT NULL AND COALESCE(points,0)<>0
               ORDER BY lineup`;
        const [rows] = await this.pool.execute(sql, [groupcode]);
        return rows as QuestionRow[];
    }

    async getGroupQuestions(groupcode: number) {
        const sql = `SELECT * FROM question WHERE groupcode=? ORDER BY lineup`;
        const [rows] = await this.pool.execute(sql, [groupcode]);
        return rows as QuestionRow[];
    }

    async getResultTypeLabel(resulttypeId: number) {
        if (this.rtLabelById.has(resulttypeId)) {
            return this.rtLabelById.get(resulttypeId)!;
        }
        const sql = `SELECT label FROM resulttype WHERE id=? LIMIT 1`;
        const [rows] = await this.pool.execute(sql, [resulttypeId]);
        const label = (rows as any[])[0]?.label as string | undefined;
        if (label != null) this.rtLabelById.set(resulttypeId, label);
        return label ?? '';
    }

    // -----------------------
    // Helpers
    // -----------------------

    /** Human-readable label for a list item id. */
    async getListItemLabelById(listItemId: number): Promise<string | null> {
        if (this.listItemLabelById.has(listItemId)) {
            return this.listItemLabelById.get(listItemId)!;
        }
        const [rows] = await this.pool.execute(
            `SELECT item.label
             FROM listitem
             INNER JOIN item ON listitem.item_id = item.id
             WHERE listitem.id = ?
             LIMIT 1`,
            [listItemId]
        );
        const label = (rows as any[])[0]?.label as string | undefined ?? null;
        this.listItemLabelById.set(listItemId, label);
        return label;
    }

    /** Resulttype label for a given question id. */
    async getResultTypeLabelForQuestion(questionId: number): Promise<string | ''> {
        const sql = `
          SELECT rt.label
          FROM question q
          INNER JOIN resulttype rt ON rt.id = q.resulttype_id
          WHERE q.id = ?
          LIMIT 1
        `;
        const [rows] = await this.pool.execute(sql, [questionId]);
        return ((rows as any[])[0]?.label as string | undefined) ?? '';
    }

    /** Minimal question metadata with resulttype label. */
    async getByBetIdWithResultTypes(betId: number): Promise<Array<{ id: number; resulttypeLabel: string }>> {
        const sql = `
          SELECT q.id, rt.label AS resulttypeLabel
          FROM question q
          INNER JOIN resulttype rt ON rt.id = q.resulttype_id
          WHERE q.bet_id = ?
        `;
        const [rows] = await this.pool.execute(sql, [betId]);
        return (rows as any[]).map(r => ({ id: Number(r.id), resulttypeLabel: String(r.resulttypeLabel) }));
    }

    async getQuestionById(id: number): Promise<QuestionRow | null> {
        const [rows] = await this.pool.execute(`SELECT * FROM question WHERE id = ? LIMIT 1`, [id]);
        const row = (rows as any[])[0] ?? null;
        return row as QuestionRow | null;
    }

    /**
     * Resolve listitem_id by (questionId, item.label).
     * Schema path: question -> question_list(list_id) -> listitem(item_id) -> item(label)
     */
    async findListItemIdByQuestionAndLabel(questionId: number, label: string): Promise<number | null> {
        const [rows] = await this.pool.execute(
            `
        SELECT li.id AS id
        FROM question_list ql
        INNER JOIN listitem li ON li.list_id = ql.list_id
        INNER JOIN item it      ON it.id = li.item_id
        WHERE ql.question_id = ? AND it.label = ?
        LIMIT 1
        `,
            [questionId, label]
        );
        const id = (rows as any[])[0]?.id;
        return id != null ? Number(id) : null;
    }}