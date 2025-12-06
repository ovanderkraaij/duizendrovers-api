// src/modules/statistics/statistics.service.ts
import type {
    StatisticsPageKey,
    StatisticsPageRequestDto,
    StatsPageDto,
    StatsPerSeasonValueDto,
    StatsRowDto,
    StatsSeasonDto,
    TotalScoreSeasonRow,
    TotalScoreUserSeasonRow,
} from "./statistics.types";
import {StatisticsRepo} from "./statistics.repo";

interface SeasonWeight {
    seasonId: number;
    label: string;
    weightFactor: number; // 1.0 = 100%; business rules can change this per page
}

/**
 * Service to construct fully-formed statistics pages for the FE.
 * No SQL, no HTTP — pure composition and formatting.
 */
export class StatisticsService {
    private readonly repo: StatisticsRepo;

    constructor(repo: StatisticsRepo) {
        this.repo = repo;
    }
    async getStatisticsPage(request: StatisticsPageRequestDto): Promise<StatsPageDto> {
        switch (request.stats_page) {
            case "total_score":
                return this.buildTotalScorePage(request);
            case "eagles":
                return this.buildEaglesPage(request);
            case "total_points":
                return this.buildTotalPointsPage(request);
            case "ups_missed":
                return this.buildSubmissionCoveragePage(request, "ups_missed");
            case "longest_time":
                return this.buildSubmissionCoveragePage(request, "longest_time");
            case "most_efficient":
                return this.buildMostEfficientPage(request);
            default:
                // No hidden fallbacks — we only support explicit keys.
                throw new Error(`Unsupported stats_page: ${request.stats_page}`);
        }
    }

    /**
     * "Total Score" page:
     * - total score of participants over all seasons
     * - individual score of participants per season
     * - supertext per season = final position in that season
     * - page can be virtual or not (based on is_virtual flag)
     * - total per user is a weighted sum over seasons
     *   (for total_score: 100% for every season)
     */
    private async buildTotalScorePage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const {is_virtual, user_id} = request;

        // 1) Fetch seasons & weights
        const seasonsRaw = await this.repo.getSeasonsForTotalScore(is_virtual);
        const seasons = this.mapScoreSeasonWeights("total_score", seasonsRaw);

        // 2) Fetch per-user, per-season scores
        const userSeasonRows = await this.repo.getUserSeasonScoresForTotalScore(
            is_virtual,
        );

        // 3) Build per-user aggregates (score league → decimals)
        const userMap = this.aggregateUserSeasonValues(
            seasons,
            userSeasonRows,
            (value) => this.formatScore(value),
        );

        // 4) Sort users by total descending, then name
        const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
            if (b.totalValue !== a.totalValue) {
                return b.totalValue - a.totalValue;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        // 5) Build rows with positions
        const rows: StatsRowDto[] = [];
        let lastTotal: number | null = null;
        let lastPosition = 0;

        sortedUsers.forEach((u, index) => {
            const isTie = lastTotal !== null && u.totalValue === lastTotal;
            const position = isTie ? lastPosition : index + 1;

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: this.formatScore(u.totalValue),
                total_supertext: null,
                per_season_values: u.perSeasonValues,
            });

            lastTotal = u.totalValue;
            lastPosition = position;
        });

        // 6) Personal row information
        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = seasons.map((s) => ({
            season_id: s.seasonId,
            season_label: s.seasonId.toString(),
        }));

        // 7) Build DTO (payload shape stays exactly as FE expects)
        const dto: StatsPageDto = {
            page_title: "De rijkste rover",
            page_subtitle: "Behaalde score over alle seizoenen",

            supports_virtual: true,
            is_virtual,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: true, // we show per-season supertext (final position)
            total_column_width_factor: 1.3,

            left_header: {
                position_label: "",
                name_label: "",
                total_label: "Totaal",
            },

            seasons: seasonsDto,
            rows,
        };

        return dto;
    }

    /**
     * "Adelaarslijst" page ("eagles"):
     * - identical payload to "total_score"
     * - same underlying season scores (league_id = 1)
     * - BUT uses a descending weight pattern across seasons:
     *     current: 80%
     *     next:   60%, 50%, 40%, 30%, 25%, 20%, 15%
     *     remaining (if any): 10% minimum
     */
    private async buildEaglesPage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const {is_virtual, user_id} = request;

        // 1) Fetch seasons & weights (same seasons as total_score)
        const seasonsRaw = await this.repo.getSeasonsForTotalScore(is_virtual);
        const seasons = this.mapScoreSeasonWeights("eagles", seasonsRaw);

        // 2) Fetch per-user, per-season scores
        const userSeasonRows = await this.repo.getUserSeasonScoresForTotalScore(
            is_virtual,
        );

        // 3) Build per-user aggregates with EAGLES weights
        const userMap = this.aggregateUserSeasonValues(
            seasons,
            userSeasonRows,
            (value) => this.formatScore(value),
        );

        // 4) Sort users by total descending, then name
        const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
            if (b.totalValue !== a.totalValue) {
                return b.totalValue - a.totalValue;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        // 5) Build rows with positions
        const rows: StatsRowDto[] = [];
        let lastTotal: number | null = null;
        let lastPosition = 0;

        sortedUsers.forEach((u, index) => {
            const isTie = lastTotal !== null && u.totalValue === lastTotal;
            const position = isTie ? lastPosition : index + 1;

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: this.formatScore(u.totalValue),
                total_supertext: null,
                per_season_values: u.perSeasonValues,
            });

            lastTotal = u.totalValue;
            lastPosition = position;
        });

        // 6) Personal row information
        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = seasons.map((s) => ({
            season_id: s.seasonId,
            season_label: s.seasonId.toString(),
        }));

        // 7) DTO — same shape as total_score, only title/subtitle differ
        const dto: StatsPageDto = {
            page_title: "Adelaarslijst",
            page_subtitle: "De eeuwige roem",

            supports_virtual: true,
            is_virtual,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: true,
            total_column_width_factor: 1.3,

            left_header: {
                position_label: "",
                name_label: "",
                total_label: "Totaal",
            },

            seasons: seasonsDto,
            rows,
        };

        return dto;
    }

    /**
     * "Total Points" page:
     * - accumulation of correctly predicted main questions + first bonus
     * - integer points (no decimals) for both total and per season
     * - backed by answers/questions, not classification
     * - payload shape identical to "total_score"
     */
    private async buildTotalPointsPage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const {is_virtual, user_id} = request;

        // 1) Fetch seasons & weights (flat, 100% each for points)
        const seasonsRaw = await this.repo.getSeasonsForTotalPoints(is_virtual);
        const seasons = this.mapSeasonWeights(seasonsRaw);

        // 2) Fetch per-user, per-season points
        const userSeasonRows = await this.repo.getUserSeasonPointsForTotalPoints(
            is_virtual,
        );

        // 3) Build per-user aggregates (points league → integers)
        const userMap = this.aggregateUserSeasonValues(
            seasons,
            userSeasonRows,
            (value) => this.formatPoints(value),
        );

        // 4) Sort users by total descending, then name
        const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
            if (b.totalValue !== a.totalValue) {
                return b.totalValue - a.totalValue;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        // 5) Build rows with positions
        const rows: StatsRowDto[] = [];
        let lastTotal: number | null = null;
        let lastPosition = 0;

        sortedUsers.forEach((u, index) => {
            const isTie = lastTotal !== null && u.totalValue === lastTotal;
            const position = isTie ? lastPosition : index + 1;

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: this.formatPoints(u.totalValue),
                total_supertext: null,
                per_season_values: u.perSeasonValues,
            });

            lastTotal = u.totalValue;
            lastPosition = position;
        });

        // 6) Personal row information
        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = seasons.map((s) => ({
            season_id: s.seasonId,
            season_label: s.seasonId.toString(),
        }));

        // 7) DTO — same shape as total_score
        const dto: StatsPageDto = {
            page_title: "De profeet",
            page_subtitle: "Totaal aantal juiste voorspellingen",

            supports_virtual: true,
            is_virtual,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: false,
            total_column_width_factor: 1.3,

            left_header: {
                position_label: "",
                name_label: "",
                total_label: "Totaal",
            },

            seasons: seasonsDto,
            rows,
        };

        return dto;
    }

    /**
     * Shared implementation for:
     *  - "ups_missed"   (Oeps gemist)
     *  - "longest_time" (De lange adem)
     *
     * Common semantics:
     * - Only users participating in the *current* season (users_season).
     * - Only events whose deadline is in the past.
     * - For an event we look at MAIN questions only (question_id IS NULL).
     * - A user "submitted" for an event if there is at least one answer
     *   on that main question (margin variants are collapsed via DISTINCT bet.id).
     *
     * Per user:
     * - per-season cell = X_s = number of submitted main questions in that season
     * - total X = sum over seasons of X_s
     * - per-season main-question pool M_s = number of main questions in that season
     * - Y_user = sum over seasons the user participates in (users_season)
     *            of M_s (seasons they did *not* participate in are excluded)
     * - coverage ratio = X / Y_user  (0 if Y_user = 0)
     * - total_value string = "[X/Y_user]"
     *
     * Ordering:
     * - "ups_missed":
     *     primary   → lowest coverage ratio first (X / Y_user ASC)
     *     secondary → higher Y_user first (more main questions possible)
     *     tertiary  → alphabetical by name
     * - "longest_time":
     *     primary   → highest X (totalSubmitted) first
     *     secondary → higher Y_user first
     *     tertiary  → alphabetical by name
     *
     * Position (rank) tie-handling:
     * - Users share the same position only when both primary and secondary
     *   numeric keys are identical; name is *not* part of tie detection.
     */
    private async buildSubmissionCoveragePage(
        request: StatisticsPageRequestDto,
        mode: Extract<StatisticsPageKey, "ups_missed" | "longest_time">,
    ): Promise<StatsPageDto> {
        const {user_id} = request;

        // 1) Determine current season (only those participants are shown)
        const currentSeasonId = await this.repo.getCurrentSeasonId();
        if (!currentSeasonId) {
            // No current season → empty table
            const dto: StatsPageDto = {
                page_title: mode === "ups_missed" ? "Oeps gemist" : "De lange adem",
                page_subtitle:
                    mode === "ups_missed"
                        ? "Ingezonden evenementen / alle evenementen"
                        : "Meeste ingezonden evenementen",

                supports_virtual: false,
                is_virtual: false,

                personal_user_id: null,
                personal_user_position: null,
                personal_user_name: null,
                personal_row_key: null,

                has_super: false,
                total_column_width_factor: 1.8,

                left_header: {
                    position_label: "",
                    name_label: "",
                    total_label: "Totaal",
                },

                seasons: [],
                rows: [],
            };
            return dto;
        }

        // 2) Seasons with at least one past-deadline event
        const seasonsRaw = await this.repo.getSeasonsForSubmissionCoverage();
        const seasons = this.mapSeasonWeights(seasonsRaw); // flat 1.0
        const seasonIds = seasons.map((s) => s.seasonId);

        // 3) Per-season main-question counts (M_s)
        const mainQuestionCountsRaw =
            await this.repo.getMainQuestionCountsForSeasons(seasonIds);
        const mainQuestionsPerSeason = new Map<number, number>();
        mainQuestionCountsRaw.forEach((row) => {
            mainQuestionsPerSeason.set(row.season_id, row.main_questions);
        });

        // 4) All participants in the current season
        const participants = await this.repo.getParticipantsForSeason(
            currentSeasonId,
        );
        const participantIds = new Set(participants.map((p) => p.user_id));
        const participantIdList = participants.map((p) => p.user_id);

        // 5) Participation matrix for these users across all relevant seasons
        const participationRows = await this.repo.getSeasonParticipationForUsers(
            participantIdList,
            seasonIds,
        );
        const participationMap = new Map<number, Set<number>>();
        for (const row of participationRows) {
            if (!participationMap.has(row.user_id)) {
                participationMap.set(row.user_id, new Set<number>());
            }
            participationMap.get(row.user_id)!.add(row.season_id);
        }

        // 6) Per-user, per-season submission counts (X_s)
        const rowsRaw = await this.repo.getUserSeasonSubmissionCounts();

        // Build base user structures for participants
        const userMap = new Map<number,
            {
                userId: number;
                displayName: string;
                perSeasonCounts: Record<number, number>;
            }>();

        for (const p of participants) {
            const parts = [p.firstname, p.infix, p.lastname]
                .map((v) => (v ?? "").trim())
                .filter((v) => v.length > 0);
            const displayName = parts.join(" ") || `User ${p.user_id}`;

            const perSeasonCounts: Record<number, number> = {};
            seasonIds.forEach((sid) => {
                perSeasonCounts[sid] = 0;
            });

            userMap.set(p.user_id, {
                userId: p.user_id,
                displayName,
                perSeasonCounts,
            });
        }

        // Fill counts for those participants (ignore users not in current season)
        for (const row of rowsRaw) {
            if (!participantIds.has(row.user_id)) continue;
            if (!userMap.has(row.user_id)) continue;
            if (!seasonIds.includes(row.season_id)) continue;

            const user = userMap.get(row.user_id)!;
            user.perSeasonCounts[row.season_id] = row.score;
        }

        // 7) Compute totals (X, Y_user) and build table rows
        type CoverageUser = {
            userId: number;
            displayName: string;
            totalSubmitted: number; // X
            totalPossible: number; // Y_user
            coverageRatio: number; // X / Y_user (0 if Y_user = 0)
            perSeasonValues: Record<number, StatsPerSeasonValueDto>;
        };

        const coverageUsers: CoverageUser[] = [];

        for (const user of userMap.values()) {
            let totalSubmitted = 0;
            let totalPossible = 0;
            const perSeasonValues: Record<number, StatsPerSeasonValueDto> = {};

            const userSeasons = participationMap.get(user.userId) ?? new Set<number>();

            seasonIds.forEach((sid) => {
                const count = user.perSeasonCounts[sid] ?? 0;
                totalSubmitted += count;

                // Only seasons the user participates in (users_season) contribute to Y_user
                if (userSeasons.has(sid)) {
                    const mainQs = mainQuestionsPerSeason.get(sid) ?? 0;
                    totalPossible += mainQs;
                }

                // "0" is a meaningful value here (explicitly show zero submissions)
                perSeasonValues[sid] = {
                    value: count.toString(),
                    supertext: null,
                };
            });

            const coverageRatio =
                totalPossible > 0 ? totalSubmitted / totalPossible : 0;

            coverageUsers.push({
                userId: user.userId,
                displayName: user.displayName,
                totalSubmitted,
                totalPossible,
                coverageRatio,
                perSeasonValues,
            });
        }

        // 8) Sort according to mode
        coverageUsers.sort((a, b) => {
            if (mode === "ups_missed") {
                // Lower coverage first → more "oops" at the top.
                // 1) Highest percentage first
                if (b.coverageRatio !== a.coverageRatio) {
                    return b.coverageRatio - a.coverageRatio;
                }
                // 2) If equal, highest X (submitted) first
                if (b.totalSubmitted !== a.totalSubmitted) {
                    return b.totalSubmitted - a.totalSubmitted;
                }
                // 3) Alphabetical
                return a.displayName.localeCompare(b.displayName);
            } else {
                // "longest_time": primarily by totalSubmitted DESC
                if (b.totalSubmitted !== a.totalSubmitted) {
                    return b.totalSubmitted - a.totalSubmitted;
                }
                // If equal, more main questions possible first
                if (b.totalPossible !== a.totalPossible) {
                    return b.totalPossible - a.totalPossible;
                }
                // If still equal, alphabetical
                return a.displayName.localeCompare(b.displayName);
            }
        });

        // 9) Build StatsRowDto[] with positions (tie handling per primary+secondary)
        const rows: StatsRowDto[] = [];
        let lastPrimary: number | null = null;
        let lastSecondary: number | null = null;
        let lastPosition = 0;

        coverageUsers.forEach((u, index) => {
            const primary =
                mode === "ups_missed" ? u.coverageRatio : u.totalSubmitted;
            const secondary = u.totalPossible;

            const isTie =
                lastPrimary !== null &&
                primary === lastPrimary &&
                lastSecondary !== null &&
                secondary === lastSecondary;

            const position = isTie ? lastPosition : index + 1;

            const totalText = `${u.totalSubmitted}/${u.totalPossible}`;

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: totalText,
                total_supertext: null,
                per_season_values: u.perSeasonValues,
            });

            lastPrimary = primary;
            lastSecondary = secondary;
            lastPosition = position;
        });

        // 10) Personal row (if requested user participates)
        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = seasons.map((s) => ({
            season_id: s.seasonId,
            season_label: s.seasonId.toString(),
        }));

        const dto: StatsPageDto = {
            page_title: mode === "ups_missed" ? "Oeps gemist" : "De lange adem",
            page_subtitle:
                mode === "ups_missed"
                    ? "Ingezonden vragen / alle vragen"
                    : "Meeste ingezonden vragen",

            // These pages do NOT support virtual mode.
            supports_virtual: false,
            is_virtual: false,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            // No per-season supertext for these pages.
            has_super: false,
            total_column_width_factor: 1.3, // bit more room for "[X/Y]"

            left_header: {
                position_label: "",
                name_label: "",
                total_label: "Totaal",
            },

            seasons: seasonsDto,
            rows,
        };

        return dto;
    }

    /**
     * "Most Efficient" page:
     *
     * - Title:    "De meeste efficiente rover"
     * - Subtitle: "Waarde voorspelling / score voorspelling"
     * - Virtual mode: supported
     * - Metric per (user, season):
     *       efficiency_s = (score_s > 0) ? points_s / score_s : 0
     *   where:
     *       points_s = classification.points (season total)
     *       score_s  = classification.score  (season total)
     *
     * - Total metric per user (over all seasons on this page):
     *       efficiency_total = (total_score > 0)
     *                            ? total_points / total_score
     *                            : 0
     *
     * - Ordering:
     *     1) Lowest efficiency_total first (most efficient at the top)
     *     2) If equal, higher total_score first
     *     3) If still equal, alphabetical by name
     *
     * - Display:
     *     - total_value = efficiency_total formatted with 2 decimals
     *     - per-season cell = efficiency_s with 2 decimals
     *     - When score = 0 → 0.00 (as requested)
     *     - No supertext
     */
    /**
     * "Most Efficient" page:
     *
     * - Title:    "De meeste efficiente rover"
     * - Subtitle: "Waarde voorspelling / score voorspelling"
     * - Virtual mode: supported
     * - Metric per (user, season):
     *       efficiency_s = (score_s > 0) ? points_s / score_s : 0
     *   where:
     *       points_s = classification.points (season total)
     *       score_s  = classification.score  (season total)
     *
     * - Total metric per user (over all seasons on this page):
     *       efficiency_total = (total_score > 0)
     *                            ? total_points / total_score
     *                            : 0
     *
     * - Ordering:
     *     1) Highest efficiency_total first (most efficient at the top)
     *     2) If equal, higher total_score first
     *     3) If still equal, alphabetical by name
     *
     * - Display:
     *     - total_value = efficiency_total formatted with 2 decimals
     *     - per-season cell = efficiency_s with 2 decimals
     *     - When score = 0 → 0.00 (as requested)
     *     - No supertext
     */
    private async buildMostEfficientPage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const { is_virtual, user_id } = request;

        // 1) Seasons are the same "score league" seasons as total_score/eagles
        const seasonsRaw = await this.repo.getSeasonsForTotalScore(is_virtual);
        const seasons: SeasonWeight[] = seasonsRaw.map((row) => ({
            seasonId: row.season_id,
            label: row.season_label,
            weightFactor: 1.0,
        }));
        const seasonIds = seasons.map((s) => s.seasonId);

        // 2) Fetch per-user, per-season points + score from classification
        const rowsRaw: EfficiencyUserSeasonRow[] =
            await this.repo.getUserSeasonPointsAndScoresForEfficiency(is_virtual);

        type UserAgg = {
            userId: number;
            displayName: string;
            // track per-season points/score
            perSeason: Map<number, { points: number; score: number }>;
            totalPoints: number;
            totalScore: number;
        };

        const userMap = new Map<number, UserAgg>();

        for (const row of rowsRaw) {
            if (!userMap.has(row.user_id)) {
                const parts = [row.firstname, row.infix, row.lastname]
                    .map((p) => (p ?? "").trim())
                    .filter((p) => p.length > 0);
                const displayName = parts.join(" ") || `User ${row.user_id}`;

                userMap.set(row.user_id, {
                    userId: row.user_id,
                    displayName,
                    perSeason: new Map<number, { points: number; score: number }>(),
                    totalPoints: 0,
                    totalScore: 0,
                });
            }

            const user = userMap.get(row.user_id)!;
            const seasonId = row.season_id;

            const existing = user.perSeason.get(seasonId) ?? { points: 0, score: 0 };
            existing.points += row.points ?? 0;
            existing.score += row.score ?? 0;
            user.perSeason.set(seasonId, existing);

            user.totalPoints += row.points ?? 0;
            user.totalScore += row.score ?? 0;
        }

        // 3) Build per-user DTO entries with ratios
        const usersWithEfficiency = Array.from(userMap.values()).map((user) => {
            const perSeasonValues: Record<number, StatsPerSeasonValueDto> = {};

            seasonIds.forEach((sid) => {
                const data = user.perSeason.get(sid);
                if (!data) {
                    perSeasonValues[sid] = { value: null, supertext: null };
                    return;
                }

                const { points, score } = data;
                const eff = score > 0 ? points / score : 0;
                perSeasonValues[sid] = {
                    value: eff.toFixed(2),
                    supertext: null,
                };
            });

            const totalEff =
                user.totalScore > 0 ? user.totalPoints / user.totalScore : 0;

            return {
                userId: user.userId,
                displayName: user.displayName,
                totalEff,
                totalScore: user.totalScore,
                perSeasonValues,
            };
        });

        // 4) Sort: highest ratio first, then higher totalScore, then name
        usersWithEfficiency.sort((a, b) => {
            if (b.totalEff !== a.totalEff) {
                return b.totalEff - a.totalEff; // descending → highest efficiency first
            }
            if (b.totalScore !== a.totalScore) {
                return b.totalScore - a.totalScore; // more score wins tie
            }
            return a.displayName.localeCompare(b.displayName);
        });

        // 5) Build rows with positions (ties on ratio + totalScore)
        const rows: StatsRowDto[] = [];
        let lastEff: number | null = null;
        let lastScore: number | null = null;
        let lastPosition = 0;

        usersWithEfficiency.forEach((u, index) => {
            const isTie =
                lastEff !== null &&
                lastScore !== null &&
                u.totalEff === lastEff &&
                u.totalScore === lastScore;

            const position = isTie ? lastPosition : index + 1;

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: u.totalEff.toFixed(2),
                total_supertext: null,
                per_season_values: u.perSeasonValues,
            });

            lastEff = u.totalEff;
            lastScore = u.totalScore;
            lastPosition = position;
        });

        // 6) Personal row
        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = seasons.map((s) => ({
            season_id: s.seasonId,
            season_label: s.seasonId.toString(),
        }));

        const dto: StatsPageDto = {
            page_title: "De meeste efficiente rover",
            page_subtitle: "Waarde voorspelling / score voorspelling",

            supports_virtual: true,
            is_virtual,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: false,
            total_column_width_factor: 1.3,

            left_header: {
                position_label: "",
                name_label: "",
                total_label: "Totaal",
            },

            seasons: seasonsDto,
            rows,
        };

        return dto;
    }

    /**
     * Flat weights (100%) for pages that do not have special patterns,
     * such as "total_points" and submission coverage pages.
     */
    private mapSeasonWeights(seasonsRaw: TotalScoreSeasonRow[]): SeasonWeight[] {
        return seasonsRaw.map((row) => ({
            seasonId: row.season_id,
            label: row.season_label,
            weightFactor: row.weight_percent / 100, // 100 → 1.0
        }));
    }


    /**
     * Flat weights (100%) for pages that do not have special patterns,
     * such as "total_points" and submission coverage pages.
     */
    private mapSeasonWeights(seasonsRaw: TotalScoreSeasonRow[]): SeasonWeight[] {
        return seasonsRaw.map((row) => ({
            seasonId: row.season_id,
            label: row.season_label,
            weightFactor: row.weight_percent / 100, // 100 → 1.0
        }));
    }

    /**
     * Weighted season mapping for score-league based pages.
     *
     * - "total_score": all seasons 100% (1.0)
     * - "eagles": current season 80%; then 60, 50, 40, 30, 25, 20, 15;
     *             any remaining seasons get 10% (0.1).
     *
     * We assume seasonsRaw is already ordered DESC by season_id,
     * so index 0 is the "current" season.
     */
    private mapScoreSeasonWeights(
        pageKey: Extract<StatisticsPageKey, "total_score" | "eagles">,
        seasonsRaw: TotalScoreSeasonRow[],
    ): SeasonWeight[] {
        if (pageKey === "total_score") {
            return seasonsRaw.map((row) => ({
                seasonId: row.season_id,
                label: row.season_label,
                weightFactor: 1.0,
            }));
        }

        // "eagles" weighting pattern in DESC order
        const pattern: number[] = [
            0.8, // current season
            0.6,
            0.5,
            0.4,
            0.3,
            0.25,
            0.2,
            0.15,
        ];

        return seasonsRaw.map((row, index) => {
            const factor = index < pattern.length ? pattern[index] : 0.1;
            return {
                seasonId: row.season_id,
                label: row.season_label,
                weightFactor: factor,
            };
        });
    }

    /**
     * Aggregate DB rows into per-user structures including:
     * - per-season values (score/points + final position)
     * - weighted total across seasons
     *
     * The caller provides the formatting function so that:
     * - score league uses decimals
     * - points league uses integer strings
     */
    private aggregateUserSeasonValues(
        seasons: SeasonWeight[],
        rows: TotalScoreUserSeasonRow[],
        formatValue: (value: number) => string,
    ): Map<number,
        {
            userId: number;
            displayName: string;
            totalValue: number;
            perSeasonValues: Record<number, StatsPerSeasonValueDto>;
        }> {
        const seasonIds = seasons.map((s) => s.seasonId);
        const seasonWeightMap = new Map<number, number>();
        seasons.forEach((s) => {
            seasonWeightMap.set(s.seasonId, s.weightFactor);
        });

        const userMap = new Map<number,
            {
                userId: number;
                displayName: string;
                totalValue: number;
                perSeasonValues: Record<number, StatsPerSeasonValueDto>;
            }>();

        for (const row of rows) {
            const seasonId = row.season_id;
            if (!seasonWeightMap.has(seasonId)) {
                // Should not happen if queries are consistent; skip to be safe.
                continue;
            }

            const weight = seasonWeightMap.get(seasonId) ?? 1.0;
            const weighted = row.score * weight;

            if (!userMap.has(row.user_id)) {
                const perSeasonValues: Record<number, StatsPerSeasonValueDto> = {};
                seasonIds.forEach((id) => {
                    perSeasonValues[id] = {value: null, supertext: null};
                });

                // Construct display name in BE (shared for all stats pages)
                const parts = [row.firstname, row.infix, row.lastname]
                    .map((p) => (p ?? "").trim())
                    .filter((p) => p.length > 0);

                const display = parts.join(" ") || `User ${row.user_id}`;

                userMap.set(row.user_id, {
                    userId: row.user_id,
                    displayName: display,
                    totalValue: 0,
                    perSeasonValues,
                });
            }

            const user = userMap.get(row.user_id)!;
            user.totalValue += weighted;
            user.perSeasonValues[seasonId] = {
                value: formatValue(row.score),
                supertext:
                    row.final_position != null ? String(row.final_position) : null,
            };
        }

        // Ensure all users have all season keys, even if they had no value in some seasons.
        for (const user of userMap.values()) {
            seasonIds.forEach((id) => {
                if (!user.perSeasonValues[id]) {
                    user.perSeasonValues[id] = {value: null, supertext: null};
                }
            });
        }

        return userMap;
    }

    /**
     * Simple numeric formatting — BE owns the string.
     * For the score league we keep two decimals.
     */
    private formatScore(value: number): string {
        return value.toFixed(2);
    }

    /**
     * Integer formatting for points:
     * - we round to nearest integer and return as string
     * - FE always receives plain integer text
     */
    private formatPoints(value: number): string {
        return Math.round(value).toString();
    }
}