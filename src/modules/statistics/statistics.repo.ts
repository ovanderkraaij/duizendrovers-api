// src/modules/statistics/statistics.repo.ts
import type { Pool } from "mysql2/promise";
import type {
    TotalScoreSeasonRow,
    TotalScoreUserSeasonRow,
    EfficiencyUserSeasonRow,
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
        ORDER BY
          c.season_id DESC,
          c.user_id ASC
      `,
            [isVirtual ? 1 : 0, isVirtual ? 1 : 0],
        );

        return rows;
    }
}

