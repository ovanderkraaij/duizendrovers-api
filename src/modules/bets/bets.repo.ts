// src/modules/bets/bets.repo.ts
import { Pool } from "mysql2/promise";

export class BetsRepo {
    constructor(private pool: Pool) {}

    async getBetTitle(betId: number) {
        const [rows] = await this.pool.query(
            `SELECT label FROM bet WHERE id = ? LIMIT 1`,
            [betId]
        );
        return (rows as any[])[0]?.label as string | undefined;
    }

    async getQuestionsWithRt(betId: number) {
        const [rows] = await this.pool.query(
            `
        SELECT
          q.id,
          q.bet_id AS betId,
          q.question_id AS parentId,
          q.groupcode AS groupCode,
          q.lineup,
          q.points,
          q.margin,
          q.step,
          q.block,
          q.virtual,
          q.title,
          q.label,
          q.descr,
          q.sport_id AS sportId,
          s.label     AS sportLabel,
          rt.id       AS rtId,
          LOWER(rt.label) AS rtLabel,
          rt.regex    AS rtRegex,
          rt.info     AS rtInfo,
          rt.placeholder AS rtPlaceholder
        FROM question q
        JOIN resulttype rt ON rt.id = q.resulttype_id
        LEFT JOIN sport s  ON s.id = q.sport_id
        WHERE q.bet_id = ?
        ORDER BY q.groupcode ASC, q.lineup ASC, q.id ASC
      `,
            [betId]
        );
        return rows as any[];
    }

    /**
     * List metadata per question (1:1 for list-type questions).
     * Includes the list_id (needed by FE model) and flags from list table.
     *
     * NOTE: We now allow calling this for ANY question id; rows will only exist
     * where a question_list entry exists.
     */
    async getListMetaForQuestions(questionIds: number[]) {
        if (!questionIds.length) return [] as any[];
        const placeholders = questionIds.map(() => "?").join(",");
        const [rows] = await this.pool.query(
            `
        SELECT
          ql.question_id      AS questionId,
          ql.list_id          AS listId,
          l.disable_order     AS disableOrder,
          l.no_double_team    AS noDoubleTeam,
          l.no_double_label   AS noDoubleLabel,
          l.show_teams        AS showTeams
        FROM question_list ql
        JOIN list l ON l.id = ql.list_id
        WHERE ql.question_id IN (${placeholders})
      `,
            questionIds
        );
        return rows as any[];
    }

    /**
     * List items for a set of questions (used only when a question_list exists).
     */
    async getListItemsForQuestions(questionIds: number[]) {
        if (!questionIds.length) return [] as any[];
        const placeholders = questionIds.map(() => "?").join(",");
        const [rows] = await this.pool.query(
            `
        SELECT
          ql.question_id AS questionId,
          ql.list_id     AS listId,
          li.id          AS listItemId,
          it.label       AS itemLabel,
          c.ccode        AS countryCode,
          t.id           AS teamId,
          t.scode        AS teamAbbr,
          t.color        AS teamFg,
          t.bgcolor      AS teamBg
        FROM question_list ql
        JOIN listitem li ON li.list_id = ql.list_id
        JOIN item it     ON it.id = li.item_id
        LEFT JOIN country c ON c.id = it.country_id
        LEFT JOIN team    t ON t.id = it.team_id
        WHERE ql.question_id IN (${placeholders})
        ORDER BY li.id ASC
      `,
            questionIds
        );
        return rows as any[];
    }

    /** Subs (points = 0) per groupcode, ordered by lineup. */
    async getBlockChildrenMapForBet(betId: number) {
        const [rows] = await this.pool.query(
            `
        SELECT q.groupcode AS groupCode, q.id, q.points
        FROM question q
        WHERE q.bet_id = ?
        ORDER BY q.groupcode ASC, q.lineup ASC
      `,
            [betId]
        );
        const map = new Map<number, number[]>();
        for (const r of rows as any[]) {
            if (Number(r.points || 0) !== 0) continue; // subs only
            const gc = Number(r.groupCode);
            if (!map.has(gc)) map.set(gc, []);
            map.get(gc)!.push(Number(r.id));
        }
        return map;
    }

    /**
     * Leagues per question (id, label, icon).
     */
    async getLeaguesForQuestions(questionIds: number[]) {
        if (!questionIds.length) return [] as any[];
        const placeholders = questionIds.map(() => "?").join(",");
        const [rows] = await this.pool.query(
            `
        SELECT
          lq.question_id AS questionId,
          l.id           AS id,
          l.label        AS label,
          l.icon         AS icon
        FROM league_question lq
        JOIN league l ON l.id = lq.league_id
        WHERE lq.question_id IN (${placeholders})
      `,
            questionIds
        );
        return rows as any[];
    }

    /**
     * NEW: Resolve country/team meta by raw team label (case-insensitive).
     * This looks directly in the `item` table and joins country/team.
     */
    async getItemsByLabels(labels: string[]) {
        if (!labels.length) return [] as any[];
        const placeholders = labels.map(() => "?").join(",");
        const lowercased = labels.map((s) => s.toLowerCase());
        const [rows] = await this.pool.query(
            `
        SELECT
          LOWER(it.label) AS normLabel,
          it.label        AS itemLabel,
          c.ccode         AS countryCode,
          t.id            AS teamId,
          t.scode         AS teamAbbr,
          t.color         AS teamFg,
          t.bgcolor       AS teamBg
        FROM item it
        LEFT JOIN country c ON c.id = it.country_id
        LEFT JOIN team    t ON t.id = it.team_id
        WHERE LOWER(it.label) IN (${placeholders})
      `,
            lowercased
        );
        return rows as any[];
    }
}