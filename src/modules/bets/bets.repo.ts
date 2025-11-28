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

    async getBetLabelAndSeason(
        betId: number
    ): Promise<{ label: string; seasonId: number } | null> {
        const [rows] = await this.pool.query(
            `
                SELECT b.label, b.season_id AS seasonId
                FROM bet b
                WHERE b.id = ?
                    LIMIT 1
            `,
            [betId]
        );
        if (!(rows as any[])[0]) return null;
        const r = (rows as any[])[0];
        return {
            label: String(r.label),
            seasonId: Number(r.seasonId),
        };
    }

    /**
     * Bet meta for bundle DTO: label + deadline.
     */
    async getBetMeta(
        betId: number
    ): Promise<{ betId: number; label: string; deadline: Date | string | null } | null> {
        const [rows] = await this.pool.query(
            `
                SELECT id, label, deadline
                FROM bet
                WHERE id = ?
                LIMIT 1
            `,
            [betId]
        );
        const r = (rows as any[])[0];
        if (!r) return null;
        return {
            betId: Number(r.id),
            label: String(r.label ?? ""),
            deadline: r.deadline ?? null,
        };
    }

    async getPastBetsWithSameLabel(
        label: string,
        currentSeasonId: number,
        currentBetId: number
    ): Promise<Array<{ betId: number; seasonId: number; seasonLabel: string }>> {
        const [rows] = await this.pool.query(
            `
                SELECT
                    b.id          AS betId,
                    s.id          AS seasonId,
                    s.label       AS seasonLabel
                FROM bet b
                         JOIN season s ON s.id = b.season_id
                WHERE b.label = ?
                  AND b.id <> ?
                  AND s.closed = '1'
                  AND s.id <= ?
                ORDER BY s.id DESC, b.id DESC
            `,
            [label, currentBetId, currentSeasonId]
        );
        return (rows as any[]).map((r) => ({
            betId: Number(r.betId),
            seasonId: Number(r.seasonId),
            seasonLabel: String(r.seasonLabel ?? ""),
        }));
    }

    /**
     * For a given bet, return the maximum score achieved in EACH bundle (groupcode),
     * regardless of which participant scored it.
     *
     * - Does NOT filter on posted, so margin variants with score are included.
     * - Includes scores from mains, subs, and bonuses (we simply trust the final `score`).
     */
    async getBundleMaxScoresForBet(
        betId: number
    ): Promise<Array<{ groupCode: number; maxScore: number }>> {
        const [rows] = await this.pool.query(
            `
                SELECT
                    q.groupcode AS groupCode,
                    MAX(a.score) AS maxScore
                FROM answer a
                         JOIN question q ON q.id = a.question_id
                WHERE q.bet_id = ?
                  AND a.score IS NOT NULL
                GROUP BY q.groupcode
            `,
            [betId]
        );

        return (rows as any[]).map((r) => ({
            groupCode: Number(r.groupCode),
            maxScore: Number(r.maxScore ?? 0),
        }));
    }

    /**
     * For a given bet + user, return the personal score achieved in EACH bundle (groupcode).
     *
     * Semantics mirror getBundleMaxScoresForBet:
     * - We aggregate MAX(a.score) for that user within each groupcode.
     * - Margin variants are included; we trust the stored `score`.
     */
    async getBundleScoresForBetAndUser(
        betId: number,
        userId: number
    ): Promise<Array<{ groupCode: number; yourScore: number }>> {
        const [rows] = await this.pool.query(
            `
                SELECT
                    q.groupcode AS groupCode,
                    MAX(a.score) AS yourScore
                FROM answer a
                         JOIN question q ON q.id = a.question_id
                WHERE q.bet_id = ?
                  AND a.user_id = ?
                  AND a.score IS NOT NULL
                GROUP BY q.groupcode
            `,
            [betId, userId]
        );

        return (rows as any[]).map((r) => ({
            groupCode: Number(r.groupCode),
            yourScore: Number(r.yourScore ?? 0),
        }));
    }

    async getFirstMainQuestionId(betId: number): Promise<number | null> {
        const [rows] = await this.pool.query(
            `
                SELECT q.id
                FROM question q
                WHERE q.bet_id = ?
                  AND (q.question_id IS NULL OR q.question_id = 0)
                ORDER BY q.lineup ASC, q.id ASC
                    LIMIT 1
            `,
            [betId]
        );
        const raw = (rows as any[])[0]?.id;
        if (raw == null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }

    async countSeasonUsers(seasonId: number): Promise<number> {
        const [rows] = await this.pool.query(
            `
                SELECT COUNT(*) AS cnt
                FROM users_season us
                WHERE us.season_id = ?
            `,
            [seasonId]
        );
        const raw = (rows as any[])[0]?.cnt;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * Check if a given user was part of a given season.
     */
    async isUserInSeason(seasonId: number, userId: number): Promise<boolean> {
        const [rows] = await this.pool.query(
            `
                SELECT 1 AS present
                FROM users_season us
                WHERE us.season_id = ?
                  AND us.user_id = ?
                    LIMIT 1
            `,
            [seasonId, userId]
        );
        return (rows as any[]).length > 0;
    }

    /**
     * Participation for the event:
     * - We consider "predicted this event" == "has a posted answer on the FIRST main question".
     * - For margin questions, posted=1 is the user-entered center; that's what we want here.
     */
    async countParticipantsForQuestion(questionId: number): Promise<number> {
        const [rows] = await this.pool.query(
            `
                SELECT COUNT(DISTINCT a.user_id) AS cnt
                FROM answer a
                WHERE a.question_id = ?
                  AND a.posted = 1
            `,
            [questionId]
        );
        const raw = (rows as any[])[0]?.cnt;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    async isBetVirtual(betId: number): Promise<boolean> {
        const [rows] = await this.pool.query(
            `
                SELECT
                    SUM(CASE WHEN q.virtual = '1' THEN 1 ELSE 0 END) AS virtualCount,
                    SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END)     AS unsolvedCount
                FROM question q
                         LEFT JOIN solution s ON s.question_id = q.id
                WHERE q.bet_id = ?
                  AND (q.question_id IS NULL OR q.question_id = 0)
            `,
            [betId]
        );
        const r = (rows as any[])[0] ?? {};
        const virtualCount = Number(r.virtualCount ?? 0);
        const unsolvedCount = Number(r.unsolvedCount ?? 0);
        return virtualCount > 0 || unsolvedCount > 0;
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