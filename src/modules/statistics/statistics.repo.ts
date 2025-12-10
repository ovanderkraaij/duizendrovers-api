// src/modules/statistics/statistics.repo.ts
import type {Pool} from "mysql2/promise";
import type {
    BullseyeRow,
    EfficiencyUserSeasonRow,
    OnThroneUserSeasonRow,
    TotalScoreSeasonRow,
    TotalScoreUserSeasonRow,
    VirtualLeagueLeaderRow,
    AmongUsRow, RealLeagueWinnerRow,
} from "./statistics.types";

/**
 * Repository for statistics-related reads.
 * All SQL stays here; services stay pure/typed.
 */
export class StatisticsRepo {
    private readonly pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Seasons that should appear on the "total_score" and "eagles" pages.
     *
     * For now:
     * - We include all seasons that have classification rows in league_id = 1.
     * - We expose a weight_percent column which is 100 for all seasons.
     *
     * This is score-league based.
     */
    async getSeasonsForTotalScore(
        isVirtual: boolean,
    ): Promise<TotalScoreSeasonRow[]> {
        const [rows] = await this.pool.query<TotalScoreSeasonRow[]>(
            `
                SELECT s.id    AS season_id,
                       s.label AS season_label,
                       100     AS weight_percent
                FROM season s
                         INNER JOIN classification c
                                    ON c.season_id = s.id
                                        AND c.league_id = 1
                                        AND c.\`virtual\` = ?
                GROUP BY s.id, s.label
                ORDER BY s.id DESC
            `,
            [isVirtual ? 1 : 0],
        );

        return rows;
    }

    /**
     * Per-user, per-season scores for the "total_score" / "eagles" pages.
     *
     * Assumptions:
     * - classification table contains the latest standing per (season, league, virtual, sequence).
     * - We want the *latest* sequence per season (final snapshot).
     * - league_id = 1 is the "score" league (single-user totals, not squads).
     *
     * The FE will:
     * - display score as main value
     * - display final_position as supertext for each season cell
     *
     * Additional rule:
     * - We only include seasons in which the user actually participates,
     *   as defined by users_season (user_id + season_id).
     */
    async getUserSeasonScoresForTotalScore(
        isVirtual: boolean,
    ): Promise<TotalScoreUserSeasonRow[]> {
        const [rows] = await this.pool.query<TotalScoreUserSeasonRow[]>(
            `
                SELECT c.user_id   AS user_id,
                       u.firstname AS firstname,
                       u.infix     AS infix,
                       u.lastname  AS lastname,
                       c.season_id AS season_id,
                       c.score     AS score,
                       c.seed      AS final_position
                FROM classification c
                         INNER JOIN users u
                                    ON u.id = c.user_id
                         INNER JOIN (SELECT c2.season_id         AS season_id,
                                            MAX(c2.\`sequence\`) AS max_sequence
                                     FROM classification c2
                                     WHERE c2.league_id = 1
                                       AND c2.\`virtual\` = ?
                                     GROUP BY c2.season_id) last_seq
                                    ON last_seq.season_id = c.season_id
                                        AND last_seq.max_sequence = c.\`sequence\`
                         INNER JOIN users_season us
                                    ON us.user_id = c.user_id
                                        AND us.season_id = c.season_id
                WHERE c.league_id = 1
                  AND c.\`virtual\` = ?
                ORDER BY c.season_id DESC,
                         c.seed ASC
            `,
            [isVirtual ? 1 : 0, isVirtual ? 1 : 0],
        );

        return rows;
    }

    /**
     * Seasons that should appear on the "total_points" page.
     *
     * Here we derive seasons from questions/bets, not from classification, because
     * "points" is literally:
     *   - 1 point for a correct main question
     *   - 1 point for a correct *first bonus* question
     *
     * A season is included if it has at least one MAIN question.
     *
     * Virtual-mode rule:
     * - isVirtual = false → only questions with q_main.virtual = '0'
     * - isVirtual = true  → questions with both virtual = '0' and '1'
     *                       (i.e. no virtual filter here)
     *
     * Bundling is done by groupcode, NOT by the "block" column.
     */
    async getSeasonsForTotalPoints(
        isVirtual: boolean,
    ): Promise<TotalScoreSeasonRow[]> {
        const virtualClause = isVirtual ? "" : "AND q_main.`virtual` = '0'";

        const [rows] = await this.pool.query<TotalScoreSeasonRow[]>(
            `
                SELECT s.id    AS season_id,
                       s.label AS season_label,
                       100     AS weight_percent
                FROM season s
                         INNER JOIN bet b
                                    ON b.season_id = s.id
                         INNER JOIN question q_main
                                    ON q_main.bet_id = b.id
                                        AND q_main.question_id IS NULL -- main question in a bundle
                    ${virtualClause}
                GROUP BY s.id, s.label
                ORDER BY s.id DESC
            `,
        );

        return rows;
    }

    /**
     * Per-user, per-season *points* for the "total_points" page.
     *
     * We count:
     *   - each correct MAIN question (main = question_id IS NULL)
     *   - plus each correct *FIRST BONUS* question
     *
     * FIRST BONUS is defined purely via:
     *   - same groupcode (this is the bundle id)
     *   - child question (question.question_id = main.id)
     *   - the child with the LOWEST lineup within that bundle
     *   - AND that child must have points > 0 (real bonus, not a sub-question)
     *
     * We explicitly do NOT use "block" for grouping. groupcode is the bundle key.
     * posted is intentionally NOT used here per project rule 24.
     *
     * Additional rules:
     * - We only count seasons in which the user actually participates
     *   (users_season).
     * - Virtual-mode rule (aligned with the rest of the app):
     *     isVirtual = false → only questions with q.virtual = '0'
     *     isVirtual = true  → questions with both virtual = '0' and '1'
     *                         (no virtual filter in SQL).
     */
    async getUserSeasonPointsForTotalPoints(
        isVirtual: boolean,
    ): Promise<TotalScoreUserSeasonRow[]> {
        const virtualClause = isVirtual ? "" : "AND q.`virtual` = '0'";

        const sql = `
            SELECT a.user_id   AS user_id,
                   u.firstname AS firstname,
                   u.infix     AS infix,
                   u.lastname  AS lastname,
                   s.id        AS season_id,
                   COUNT(*)    AS score,
                   NULL        AS final_position
            FROM answer a
                     INNER JOIN question q
                                ON q.id = a.question_id
                     INNER JOIN bet b
                                ON b.id = q.bet_id
                     INNER JOIN season s
                                ON s.id = b.season_id
                     INNER JOIN users u
                                ON u.id = a.user_id
                     INNER JOIN users_season us
                                ON us.user_id = a.user_id
                                    AND us.season_id = s.id
            WHERE a.correct = '1' ${virtualClause}
        AND (
              q.question_id IS NULL
              OR (
                q.question_id IS NOT NULL
                AND q.points > 0
                AND q.lineup = (
                  SELECT MIN(qb.lineup)
                  FROM question qb
                  WHERE qb.bet_id      = q.bet_id
                    AND qb.groupcode   = q.groupcode
                    AND qb.question_id = q.question_id
                    AND qb.points > 0
                )
              )
            )
            GROUP BY
                a.user_id,
                u.firstname,
                u.infix,
                u.lastname,
                s.id
            ORDER BY
                s.id DESC,
                score DESC
        `;

        const [rows] =
            await this.pool.query<TotalScoreUserSeasonRow[]>(sql);
        return rows;
    }

    /**
     * Current season id:
     * - "current" is defined as the highest season.id where closed = '0'.
     * - Returns null if none found.
     */
    async getCurrentSeasonId(): Promise<number | null> {
        const [rows] = await this.pool.query<Array<{ current_season_id: number | null }>>(
            `
                SELECT MAX(s.id) AS current_season_id
                FROM season s
                WHERE s.closed = '0'
            `,
        );

        const row = rows[0];
        return row?.current_season_id ?? null;
    }

    /**
     * Seasons that should appear on the submission coverage pages:
     * - "ups_missed"
     * - "longest_time"
     *
     * We include all seasons that have at least one bet with a deadline in the past.
     * Weight is flat 100% for all; services do not reweight these pages.
     */
    async getSeasonsForSubmissionCoverage(): Promise<TotalScoreSeasonRow[]> {
        const [rows] = await this.pool.query<TotalScoreSeasonRow[]>(
            `
                SELECT s.id    AS season_id,
                       s.label AS season_label,
                       100     AS weight_percent
                FROM season s
                         INNER JOIN bet b
                                    ON b.season_id = s.id
                                        AND b.deadline IS NOT NULL
                                        AND b.deadline < NOW()
                GROUP BY s.id, s.label
                ORDER BY s.id DESC
            `,
        );

        return rows;
    }

    /**
     * Total number of MAIN questions in events (bets) whose deadline is in the past.
     *
     * NOTE: This is the global count. For "ups_missed" / "longest_time"
     * we now use a per-user denominator instead (see service + new repo helpers).
     * This method is kept for possible future use elsewhere.
     */
    async getTotalPastEventsCount(): Promise<number> {
        const [rows] = await this.pool.query<Array<{ total_events: number }>>(
            `
                SELECT COUNT(DISTINCT q_main.id) AS total_events
                FROM bet b
                         INNER JOIN question q_main
                                    ON q_main.bet_id = b.id
                                        AND q_main.question_id IS NULL
                WHERE b.deadline IS NOT NULL
                  AND b.deadline < NOW()
            `,
        );

        return rows[0]?.total_events ?? 0;
    }

    /**
     * All users that are participating in the given season (users_season).
     * This defines the user set for the submission coverage pages:
     * - we only show users who participate in the CURRENT season.
     */
    async getParticipantsForSeason(
        seasonId: number,
    ): Promise<Array<Pick<TotalScoreUserSeasonRow,
        "user_id" | "firstname" | "infix" | "lastname">>> {
        const [rows] = await this.pool.query<Array<Pick<TotalScoreUserSeasonRow,
            "user_id" | "firstname" | "infix" | "lastname">>>(
            `
                SELECT u.id        AS user_id,
                       u.firstname AS firstname,
                       u.infix     AS infix,
                       u.lastname  AS lastname
                FROM users_season us
                         INNER JOIN users u
                                    ON u.id = us.user_id
                WHERE us.season_id = ?
                ORDER BY u.firstname, u.infix, u.lastname
            `,
            [seasonId],
        );

        return rows;
    }

    /**
     * Per-user, per-season submission "main-question counts".
     *
     * For each event (bet):
     * - If the user has submitted the event (has at least one answer on a MAIN
     *   question of that event),
     * - we count **all MAIN questions** of that event for that user.
     *
     * Because of the business rule "a user cannot submit only one main question
     * in the event" (one = all), we can safely:
     * - join answers directly on main questions;
     * - and count DISTINCT main question IDs per user and season.
     *
     * score = number of main questions (not events) that the user has
     *         answered in events whose deadline is in the past.
     */
    async getUserSeasonSubmissionCounts(): Promise<TotalScoreUserSeasonRow[]> {
        const [rows] = await this.pool.query<TotalScoreUserSeasonRow[]>(
            `
                SELECT a.user_id                 AS user_id,
                       u.firstname               AS firstname,
                       u.infix                   AS infix,
                       u.lastname                AS lastname,
                       s.id                      AS season_id,
                       COUNT(DISTINCT q_main.id) AS score,
                       NULL                      AS final_position
                FROM bet b
                         INNER JOIN season s
                                    ON s.id = b.season_id
                         INNER JOIN question q_main
                                    ON q_main.bet_id = b.id
                                        AND q_main.question_id IS NULL -- MAIN questions only
                         INNER JOIN answer a
                                    ON a.question_id = q_main.id -- user has answered this MAIN
                         INNER JOIN users u
                                    ON u.id = a.user_id
                WHERE b.deadline IS NOT NULL
                  AND b.deadline < NOW() -- only events in the past
                GROUP BY a.user_id,
                         u.firstname,
                         u.infix,
                         u.lastname,
                         s.id
                ORDER BY s.id DESC,
                         score DESC
            `,
        );

        return rows;
    }

    /**
     * Main-question counts per season for past-deadline events.
     *
     * This is used to compute the **per-user** denominator Y:
     *   Y_user = sum over seasons the user participates in of
     *            main_questions_in_that_season.
     */
    async getMainQuestionCountsForSeasons(
        seasonIds: number[],
    ): Promise<Array<{ season_id: number; main_questions: number }>> {
        if (seasonIds.length === 0) {
            return [];
        }

        const [rows] = await this.pool.query<Array<{ season_id: number; main_questions: number }>>(
            `
                SELECT s.id                      AS season_id,
                       COUNT(DISTINCT q_main.id) AS main_questions
                FROM bet b
                         INNER JOIN season s
                                    ON s.id = b.season_id
                         INNER JOIN question q_main
                                    ON q_main.bet_id = b.id
                                        AND q_main.question_id IS NULL -- MAIN questions only
                WHERE b.deadline IS NOT NULL
                  AND b.deadline < NOW()
                  AND s.id IN (?)
                GROUP BY s.id
            `,
            [seasonIds],
        );

        return rows;
    }

    /**
     * Participation matrix for a set of users over a set of seasons.
     *
     * This tells us, for each (user_id, season_id), whether the user
     * is in users_season for that season (i.e. really participated).
     *
     * Used by submission-coverage pages to:
     * - exclude seasons a user did not participate in from their Y total.
     */
    async getSeasonParticipationForUsers(
        userIds: number[],
        seasonIds: number[],
    ): Promise<Array<{ user_id: number; season_id: number }>> {
        if (userIds.length === 0 || seasonIds.length === 0) {
            return [];
        }

        const [rows] = await this.pool.query<Array<{ user_id: number; season_id: number }>>(
            `
                SELECT us.user_id,
                       us.season_id
                FROM users_season us
                WHERE us.user_id IN (?)
                  AND us.season_id IN (?)
            `,
            [userIds, seasonIds],
        );

        return rows;
    }
    /**
     * Per-user, per-season "points" + "score" for the "most_efficient" page.
     *
     * - Reads from the classification table (league_id = 1).
     * - Uses the latest sequence per (season, virtual) as for total_score/eagles.
     * - Respects virtual mode:
     *     isVirtual = false → classification.virtual = '0'
     *     isVirtual = true  → classification.virtual = '1'
     * - Only includes users that participate in the season (users_season).
     */
    async getUserSeasonPointsAndScoresForEfficiency(
        isVirtual: boolean,
    ): Promise<EfficiencyUserSeasonRow[]> {
        const [rows] = await this.pool.query<EfficiencyUserSeasonRow[]>(
            `
        SELECT
          c.user_id        AS user_id,
          u.firstname      AS firstname,
          u.infix          AS infix,
          u.lastname       AS lastname,
          c.season_id      AS season_id,
          c.points         AS points,
          c.score          AS score
        FROM classification c
        INNER JOIN users u
          ON u.id = c.user_id
        INNER JOIN (
          SELECT
            c2.season_id        AS season_id,
            MAX(c2.\`sequence\`) AS max_sequence
          FROM classification c2
          WHERE c2.league_id = 1
            AND c2.\`virtual\` = ?
          GROUP BY c2.season_id
        ) last_seq
          ON last_seq.season_id     = c.season_id
         AND last_seq.max_sequence  = c.\`sequence\`
        INNER JOIN users_season us
          ON us.user_id   = c.user_id
         AND us.season_id = c.season_id
        WHERE
          c.league_id = 1
          AND c.\`virtual\` = ?
        ORDER BY c.season_id DESC,
                 c.user_id ASC
            `,
            [isVirtual ? 1 : 0, isVirtual ? 1 : 0],
        );

        return rows;
    }

    /**
     * Seasons that should appear on the "on_throne" page.
     *
     * Rule:
     * - Include only seasons where there is at least one classification snapshot
     *   for league_id = 1 and virtual = 0.
     */
    async getSeasonsForOnThrone(): Promise<TotalScoreSeasonRow[]> {
        const [rows] = await this.pool.query<TotalScoreSeasonRow[]>(
            `
                SELECT s.id    AS season_id,
                       s.label AS season_label,
                       100     AS weight_percent
                FROM season s
                         INNER JOIN classification c
                                    ON c.season_id = s.id
                                        AND c.league_id = 1
                                        AND c.\`virtual\` = 0
                GROUP BY s.id, s.label
                ORDER BY s.id DESC
            `,
        );

        return rows;
    }

    /**
     * Per-user, per-season total days on position 1 ("on the throne").
     *
     * IMPORTANT CHANGE:
     * - We no longer use classification.insertion as the time anchor.
     * - Instead, for each snapshot (season/league/virtual/sequence) we derive
     *   its timestamp from question.answered, which is the *real* moment the
     *   solution was given.
     *
     * Snapshot time:
     * - For each (season_id, league_id, virtual, sequence) we:
     *     • Join classification → question on question_id.
     *     • Take MIN(question.answered) as snapshot_answered.
     * - We then walk these snapshots in chronological order of snapshot_answered
     *   and compute full days to the next snapshot.
     *
     * The rest of the semantics stay identical:
     * - Only league_id = 1, virtual = 0.
     * - Ties for seed = 1: every tied user gets the full day count.
     * - Last snapshot of a season does not accrue days (no next snapshot).
     */
    async getOnThroneUserSeasonDays(): Promise<OnThroneUserSeasonRow[]> {
        const [rows] = await this.pool.query<OnThroneUserSeasonRow[]>(
            `
                SELECT
                    c.user_id   AS user_id,
                    c.season_id AS season_id,
                    SUM(s.days_on_throne) AS days_on_throne
                FROM (
                    -- One row per snapshot (season/league/virtual/sequence),
                    -- timestamped by the REAL solution time from question.answered
                    SELECT
                        base.season_id,
                        base.league_id,
                        base.\`virtual\`,
                        base.\`sequence\`,
                        TIMESTAMPDIFF(
                            DAY,
                            base.snapshot_answered,
                            LEAD(base.snapshot_answered) OVER (
                                PARTITION BY base.season_id, base.league_id, base.\`virtual\`
                                ORDER BY base.snapshot_answered
                            )
                        ) AS days_on_throne
                    FROM (
                        SELECT
                            c.season_id,
                            c.league_id,
                            c.\`virtual\`,
                            c.\`sequence\`,
                            MIN(q.answered) AS snapshot_answered
                        FROM classification c
                        INNER JOIN question q
                            ON q.id = c.question_id
                        WHERE c.league_id = 1
                          AND c.\`virtual\` = 0
                        GROUP BY
                            c.season_id,
                            c.league_id,
                            c.\`virtual\`,
                            c.\`sequence\`
                    ) AS base
                ) AS s
                INNER JOIN classification c
                    ON c.season_id = s.season_id
                   AND c.league_id = s.league_id
                   AND c.\`virtual\` = s.\`virtual\`
                   AND c.\`sequence\` = s.\`sequence\`
                WHERE c.seed = 1
                  AND s.days_on_throne IS NOT NULL
                  AND s.days_on_throne > 0
                GROUP BY
                    c.user_id,
                    c.season_id
                ORDER BY
                    c.season_id DESC,
                    c.user_id ASC
            `,
        );

        return rows;
    }

    /**
     * Basic list of all users, for stats pages that must include
     * every user regardless of season participation.
     */
    async getAllUsersBasic(): Promise<
        Array<{
            user_id: number;
            firstname: string;
            infix: string | null;
            lastname: string;
        }>
        > {
        const [rows] = await this.pool.query<
            Array<{ user_id: number; firstname: string; infix: string | null; lastname: string }>
            >(
            `
                SELECT u.id        AS user_id,
                       u.firstname AS firstname,
                       u.infix     AS infix,
                       u.lastname  AS lastname
                FROM users u
                ORDER BY u.firstname, u.infix, u.lastname
            `,
        );

        return rows;
    }

    /**
     * Bullseye rows:
     * - One row per QUESTION inside a bundle where a user scored exactly 20 points
     *   over all questions in that bundle (same groupcode) for a bet.
     * - Bundles are defined by (bet_id, groupcode).
     * - Virtual handling:
     *
     * We intentionally do NOT filter on posted here (rule 24).
     */
    async getBullseyeRows(): Promise<BullseyeRow[]> {
        const [rows] = await this.pool.query<BullseyeRow[]>(
            `
            SELECT
              t.season_id,
              t.season_label,
              t.bet_id,
              t.bet_label,
              t.groupcode,
              t.user_id,
              t.firstname,
              t.infix,
              t.lastname,
              t.question_id,
              t.question_label,
              t.is_main,
              t.is_bonus,
              t.is_first_bonus,
              t.answer_label,
              t.answer_listitem_id,
              t.bundle_score,
              t.main_virtual
            FROM (
              SELECT
                s.id    AS season_id,
                s.label AS season_label,
                b.id    AS bet_id,
                b.label AS bet_label,
                q.groupcode AS groupcode,
                a.user_id   AS user_id,
                u.firstname AS firstname,
                u.infix     AS infix,
                u.lastname  AS lastname,
                main.\`virtual\` AS main_virtual,
                q.id        AS question_id,
                q.label     AS question_label,
                (q.question_id IS NULL)                                  AS is_main,
                (q.question_id IS NOT NULL AND q.points > 0)            AS is_bonus,
                (
                  q.question_id IS NOT NULL
                  AND q.points > 0
                  AND q.lineup = (
                    SELECT MIN(qb.lineup)
                    FROM question qb
                    WHERE qb.bet_id    = q.bet_id
                      AND qb.groupcode = q.groupcode
                      AND qb.question_id IS NOT NULL
                      AND qb.points > 0
                  )
                ) AS is_first_bonus,
                a.label      AS answer_label,
                a.listitem_id AS answer_listitem_id,
                SUM(a.score) OVER (
                  PARTITION BY s.id, b.id, q.groupcode, a.user_id
                ) AS bundle_score
              FROM answer a
              INNER JOIN question q
                ON q.id = a.question_id
              INNER JOIN question main
                ON main.bet_id    = q.bet_id
               AND main.groupcode = q.groupcode
               AND main.question_id IS NULL
              INNER JOIN bet b
                ON b.id = q.bet_id
              INNER JOIN season s
                ON s.id = b.season_id
              INNER JOIN users u
                ON u.id = a.user_id
              WHERE 1 = 1
            ) AS t
            WHERE t.bundle_score = 20
            ORDER BY
              t.season_id ASC,
              t.bet_id ASC,
              t.groupcode ASC,
              t.user_id ASC,
              t.is_main DESC,
              t.question_id ASC
            `,
        );

        return rows;
    }
    /**
     * Real league medals (gold/silver/bronze) from the "winner" table.
     *
     * Rules:
     * - Only seasons where season.closed = '1' (closed seasons).
     * - Only league_id between 1 and 10.
     * - Each row represents a single real medal for a user/season/league.
     */
    async getRealLeagueMedals(): Promise<RealLeagueWinnerRow[]> {
        const [rows] = await this.pool.query<RealLeagueWinnerRow[]>(
            `
                SELECT
                    w.season_id               AS season_id,
                    s.label                   AS season_label,
                    s.closed                  AS season_closed,
                    w.user_id                 AS user_id,
                    u.firstname               AS firstname,
                    u.infix                   AS infix,
                    u.lastname                AS lastname,
                    w.league_id               AS league_id,
                    l.label                   AS league_label,
                    l.icon                    AS league_icon
                FROM winner w
                INNER JOIN season s
                    ON s.id = w.season_id
                   AND s.closed = '1'
                INNER JOIN users u
                    ON u.id = w.user_id
                INNER JOIN league l
                    ON l.id = w.league_id
                WHERE w.league_id BETWEEN 1 AND 10
            `,
        );

        return rows;
    }

    /**
     * Onder Ons (amongus) prizes — both real and virtual.
     *
     * Virtual rule:
     * - Season with closed = '0' (the current open season) → virtual medal.
     * - Seasons with closed = '1' → real medals.
     *
     * The service is responsible for interpreting season_closed and
     * including/excluding virtual rows based on is_virtual.
     */
    async getAmongUsPrizes(): Promise<AmongUsRow[]> {
        const [rows] = await this.pool.query<AmongUsRow[]>(
            `
                SELECT
                    a.season_id            AS season_id,
                    s.label                AS season_label,
                    s.closed               AS season_closed,
                    a.user_id              AS user_id,
                    u.firstname            AS firstname,
                    u.infix                AS infix,
                    u.lastname             AS lastname,
                    a.label                AS amongus_label
                FROM amongus a
                INNER JOIN season s
                    ON s.id = a.season_id
                INNER JOIN users u
                    ON u.id = a.user_id
            `,
        );

        return rows;
    }
}

