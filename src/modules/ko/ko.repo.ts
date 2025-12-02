// src/modules/ko/ko.repo.ts
import { Pool } from "mysql2/promise";

/**
 * Low-level DB row types for KO tables
 */
export type KoBetRow = {
    id: number;
    season_id: number | null;
    label: string;
    active: string; // '0' | '1'
    closed: string; // '0' | '1'
    post_id: number;
    round: number | null;
};

export type KoQuestionRow = {
    id: number;
    ko_bet_id: number;
    resulttype_id: number | null;
    label: string;
    descr: string | null;
    deadline: Date | null;
    winnow: string; // '0' | '1'
    closed: string; // '0' | '1'
    draw: number;
    draw_date: Date | null;
    regex: string | null;
    // NOTE: ko_question also has:
    //   notification: varchar(1)
    //   opened: datetime
    // but we keep them optional for now and access via `as any` where needed.
};

export type KoUserKoBetRow = {
    ko_bet_id: number;
    user_id: number;
    eliminated: string; // '0' | '1'
    ko_question_id: number | null;
};

export type KoUserPairRow = {
    ko_question_id: number;
    home_user_id: number;
    away_user_id: number;
};

export type KoAnswerRow = {
    id: number;
    ko_question_id: number;
    user_id: number;
    result: string;
    label: string;
    correct: string; // '0' | '1'
    posted: string; // '0' | '1'
    answered: Date | null;
};

export type KoListItemRow = {
    id: number;
    list_id: number;
    label: string;
};

export type ResultTypeMetaRow = {
    id: number;
    label: string;
    regex: string | null;
    info: string | null;
    placeholder: string | null;
};

/**
 * Tournament DTOs for the KO article page.
 *
 * These types describe the FULL knockout tournament:
 * - middle rounds
 * - knockout rounds
 * - eliminated users per round
 * - all duels per round
 * - all answer entries per round
 */

export type KoTournamentPayload = {
    bet: {
        id: number;
        season_id: number | null;
        label: string;
        post_id: number;
    };

    tournament: {
        current_round_id: number | null;
        current_phase: "middle" | "knockout" | null;
        rounds: KoTournamentRound[];
    };
};

/**
 * A single round/question inside the tournament
 */
export type KoTournamentRound = {
    question_id: number;
    label: string;
    /**
     * "middle" → Voorronde N
     * "knockout" → paired rounds (Achtste finale, Kwartfinale, etc.)
     */
    phase: "middle" | "knockout";

    /**
     * true if:
     * - deadline in the future
     * - closed = 0
     */
    is_current: boolean;

    /** Dynamic label: "Voorronde 1", "Achtste finale", "Kwartfinale", etc. */
    round_label: string;

    deadline_utc: string | null;
    opened_utc: string | null;

    /** Number of participants that entered this round */
    participants_total: number;

    /** Number of participants NOT yet eliminated before this round */
    participants_alive: number;

    /** List items for list-type resulttypes (if any) */
    list_items: Array<{
        id: number;
        label: string;
    }>;

    /**
     * All answers for all participants in this round
     * Always alphabetical by display_name.
     */
    answers: {
        entries: Array<{
            user_id: number;
            display_name: string;

            /** Value displayed (e.g. "1-1", "2:04:10", list label) */
            label: string | null;

            /** Raw result string */
            result: string | null;

            answered_at_utc: string | null;

            /** Whether the player was eliminated *in this round* */
            eliminated_here: boolean;
        }>;

        /** List of eliminated users for this round, alphabetical */
        eliminated: Array<{
            user_id: number;
            display_name: string;
            answer_label: string | null;
        }>;
    };

    /**
     * Only for knockout rounds (phase = "knockout")
     * Contains the duels (A vs B)
     */
    pairs: Array<{
        home: {
            user_id: number;
            display_name: string;
            label: string | null;
            result: string | null;
            answered_at_utc: string | null;
        };

        away: {
            user_id: number;
            display_name: string;
            label: string | null;
            result: string | null;
            answered_at_utc: string | null;
        };

        first_answered_user_id: number | null;
        both_submitted: boolean;
    }>;
};

export class KoRepo {
    constructor(private readonly pool: Pool) {}

    /**
     * Active KO bet for a season.
     * We assume at most one active+open KO bet; if multiple, take the latest id.
     */
    async getActiveBetForSeason(seasonId: number): Promise<KoBetRow | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_bet
      WHERE season_id = ?
        AND active = '1'
        AND closed = '0'
      ORDER BY id DESC
      LIMIT 1
      `,
            [seasonId],
        );
        const row = (rows as any[])[0] ?? null;
        return row as KoBetRow | null;
    }

    /**
     * Current KO question for a bet:
     * - same ko_bet_id
     * - not closed
     * - deadline in the future (strict)
     * Earliest upcoming deadline wins.
     */
    async getCurrentQuestionForBet(
        koBetId: number,
        now: Date,
    ): Promise<KoQuestionRow | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_question
      WHERE ko_bet_id = ?
        AND closed = '0'
        AND deadline IS NOT NULL
        AND deadline > ?
      ORDER BY deadline ASC, id ASC
      LIMIT 1
      `,
            [koBetId, now],
        );
        const row = (rows as any[])[0] ?? null;
        return row as KoQuestionRow | null;
    }

    /**
     * Participation state for a user within a KO bet.
     */
    async getUserKoBetRow(
        koBetId: number,
        userId: number,
    ): Promise<KoUserKoBetRow | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_users_ko_bet
      WHERE ko_bet_id = ?
        AND user_id = ?
      LIMIT 1
      `,
            [koBetId, userId],
        );
        const row = (rows as any[])[0] ?? null;
        return row as KoUserKoBetRow | null;
    }

    /**
     * Return the pairing (home/away) for a user in a given KO question, if any.
     */
    async getPairForUser(
        koQuestionId: number,
        userId: number,
    ): Promise<KoUserPairRow | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_users_pair
      WHERE ko_question_id = ?
        AND (home_user_id = ? OR away_user_id = ?)
      LIMIT 1
      `,
            [koQuestionId, userId, userId],
        );
        const row = (rows as any[])[0] ?? null;
        return row as KoUserPairRow | null;
    }

    /**
     * Resulttype metadata, shared with normal questions.
     * We only select fields we actually need.
     */
    async getResultTypeMeta(
        resulttypeId: number,
    ): Promise<ResultTypeMetaRow | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT id, label, regex, info, placeholder
      FROM resulttype
      WHERE id = ?
      LIMIT 1
      `,
            [resulttypeId],
        );
        const row = (rows as any[])[0] ?? null;
        return row as ResultTypeMetaRow | null;
    }

    /**
     * List items for a KO question.
     *
     * Assumption: ko_listitem.list_id == ko_question.id
     * (i.e. one list per KO question, keyed by ko_question.id).
     */
    async getListItemsForQuestion(
        koQuestionId: number,
    ): Promise<KoListItemRow[]> {
        const [rows] = await this.pool.execute(
            `
      SELECT li.id, li.list_id, li.label
      FROM ko_listitem li
      INNER JOIN question_list ql
        ON ql.list_id = li.list_id
      WHERE ql.question_id = ?
      ORDER BY li.label ASC, li.id ASC
      `,
            [koQuestionId],
        );

        return rows as KoListItemRow[];
    }

    /**
     * Latest answer (posted or not) for a user & KO question.
     * We use answered DESC, id DESC as tie-breaker.
     */
    async getUserAnswerForQuestion(
        koQuestionId: number,
        userId: number,
    ): Promise<KoAnswerRow | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_answer
      WHERE ko_question_id = ?
        AND user_id = ?
      ORDER BY answered DESC, id DESC
      LIMIT 1
      `,
            [koQuestionId, userId],
        );
        const row = (rows as any[])[0] ?? null;
        return row as KoAnswerRow | null;
    }

    /**
     * Best-effort reverse lookup: find ko_listitem.id by (questionId, label).
     * Uses the same list_id assumption as getListItemsForQuestion.
     */
    async findListItemIdByLabel(
        koQuestionId: number,
        label: string,
    ): Promise<number | null> {
        const [rows] = await this.pool.execute(
            `
      SELECT id
      FROM ko_listitem
      WHERE list_id = ?
        AND label = ?
      LIMIT 1
      `,
            [koQuestionId, label],
        );
        const row = (rows as any[])[0] ?? null;
        if (!row) return null;
        return Number(row.id);
    }

    // -------------------------------------------------------------------------
    // Tournament helpers used by KoService.getTournament
    // -------------------------------------------------------------------------

    /**
     * All questions for a KO bet, ordered in "round" order.
     * We use id ASC as chronological approximation.
     */
    async getQuestionsForBet(koBetId: number): Promise<KoQuestionRow[]> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_question
      WHERE ko_bet_id = ?
      ORDER BY id ASC
      `,
            [koBetId],
        );
        return rows as KoQuestionRow[];
    }

    /**
     * All user participation rows for a KO bet.
     */
    async getUsersForBet(koBetId: number): Promise<KoUserKoBetRow[]> {
        const [rows] = await this.pool.execute(
            `
      SELECT *
      FROM ko_users_ko_bet
      WHERE ko_bet_id = ?
      `,
            [koBetId],
        );
        return rows as KoUserKoBetRow[];
    }

    /**
     * All answers across all questions of a KO bet.
     */
    async getAnswersForBet(koBetId: number): Promise<KoAnswerRow[]> {
        const [rows] = await this.pool.execute(
            `
      SELECT a.*
      FROM ko_answer a
      INNER JOIN ko_question q ON a.ko_question_id = q.id
      WHERE q.ko_bet_id = ?
      ORDER BY a.ko_question_id ASC, a.user_id ASC, a.answered ASC, a.id ASC
      `,
            [koBetId],
        );
        return rows as KoAnswerRow[];
    }

    /**
     * All pairs (duels) across all questions of a KO bet.
     */
    async getPairsForBet(koBetId: number): Promise<KoUserPairRow[]> {
        const [rows] = await this.pool.execute(
            `
      SELECT p.*
      FROM ko_users_pair p
      INNER JOIN ko_question q ON p.ko_question_id = q.id
      WHERE q.ko_bet_id = ?
      ORDER BY p.ko_question_id ASC, p.home_user_id ASC, p.away_user_id ASC
      `,
            [koBetId],
        );
        return rows as KoUserPairRow[];
    }

    /**
     * Map user_id -> display_name for all involved users.
     *
     * Assumption: main game users are stored in the "user" table and
     * have at least a "name" column. If there is a dedicated display_name,
     * you can adjust this method accordingly.
     */
// src/modules/ko/ko.repo.ts
    async getUserDisplayNames(
        userIds: number[],
    ): Promise<Map<number, string>> {
        const map = new Map<number, string>();

        if (userIds.length === 0) {
            return map;
        }

        const uniqueIds = Array.from(new Set(userIds));
        const placeholders = uniqueIds.map(() => "?").join(",");

        const [rows] = await this.pool.execute(
            `
      SELECT id, firstname, infix, lastname, username
      FROM users
      WHERE id IN (${placeholders})
      `,
            uniqueIds,
        );

        for (const row of rows as any[]) {
            const id = Number(row.id);

            const first = (row.firstname as string | null) ?? "";
            const infix = (row.infix as string | null) ?? "";
            const last = (row.lastname as string | null) ?? "";

            const fullNameParts = [
                first.trim(),
                infix.trim(),
                last.trim(),
            ].filter((part) => part.length > 0);

            const fullName = fullNameParts.join(" ").trim();

            const displayName: string =
                    fullName
            map.set(id, displayName);
        }

        return map;
    }
}

