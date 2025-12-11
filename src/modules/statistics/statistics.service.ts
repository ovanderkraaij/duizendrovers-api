// src/modules/statistics/statistics.service.ts

import type {
    BullseyeRequestDto,
    BullseyeRow,
    BullseyeStatsDto,
    EfficiencyUserSeasonRow,
    StatisticsPageKey,
    StatisticsPageRequestDto,
    StatsPageDto,
    StatsPerSeasonValueDto,
    StatsRowDto,
    StatsSeasonDto,
    TotalScoreSeasonRow,
    TotalScoreUserSeasonRow,
    MedalsRequestDto,
    MedalsPageDto,
    MedalsRowDto,
    MedalsSeasonDto,
    MedalsPrizeDto,
    MedalKind,
    MedalsTotalsDto,
    PalmaresRequestDto,
    PalmaresPageDto,
    PalmaresRowDto,
} from "./statistics.types";
import * as classificationService from "../classification/classification.service";
import { StatisticsRepo } from "./statistics.repo";
import { SolutionsRepo } from "../solutions/solutions.repo";

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
    private readonly solutionsRepo: SolutionsRepo;

    // CENTRAL DECIMAL SETTINGS FOR SCORE-BASED STATS PAGES
    private static readonly TOTAL_SCORE_DECIMALS = 1;
    private static readonly EAGLES_DECIMALS = 1;
    private static readonly EFFICIENCY_DECIMALS = 2;

    constructor(repo: StatisticsRepo, solutionsRepo: SolutionsRepo) {
        this.repo = repo;
        this.solutionsRepo = solutionsRepo;
    }

    async getStatisticsPage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        switch (request.stats_page) {
            case "total_score":
                return this.buildPageWithVirtualMovement(request, (r) =>
                    this.buildTotalScorePage(r),
                );
            case "eagles":
                return this.buildPageWithVirtualMovement(request, (r) =>
                    this.buildEaglesPage(r),
                );
            case "total_points":
                return this.buildPageWithVirtualMovement(request, (r) =>
                    this.buildTotalPointsPage(r),
                );
            case "most_efficient":
                return this.buildPageWithVirtualMovement(request, (r) =>
                    this.buildMostEfficientPage(r),
                );
            case "ups_missed":
                return this.buildSubmissionCoveragePage(request, "ups_missed");
            case "longest_time":
                return this.buildSubmissionCoveragePage(request, "longest_time");
            case "on_throne":
                return this.buildOnThronePage(request);
            default:
                throw new Error(`Unsupported stats_page: ${request.stats_page}`);
        }
    }

    /**
     * Wrapper for generic stats pages that:
     * - in REAL mode (is_virtual = false): just delegates to the builder
     * - in VIRTUAL mode (is_virtual = true):
     *     • builds the REAL page as baseline (is_virtual = false)
     *     • builds the VIRTUAL page (is_virtual = true)
     *     • injects movement-from-real into total_supertext of the virtual rows
     *
     * Movement convention:
     *   movement = real_position - virtual_position
     *   > 0  → moved up (better in virtual)
     *   < 0  → moved down
     *   = 0  → unchanged (encoded as "0")
     *
     * This uses the existing total_supertext field — no payload shape changes.
     */
    private async buildPageWithVirtualMovement(
        request: StatisticsPageRequestDto,
        builder: (req: StatisticsPageRequestDto) => Promise<StatsPageDto>,
    ): Promise<StatsPageDto> {
        // Real-mode request: no movement, just build once.
        if (!request.is_virtual) {
            return builder(request);
        }

        // 1) Build REAL baseline (same page, is_virtual = false).
        const realRequest: StatisticsPageRequestDto = {
            ...request,
            is_virtual: false,
        };
        const realPage = await builder(realRequest);

        const realPositionByKey = new Map<string, number>();
        for (const row of realPage.rows) {
            realPositionByKey.set(row.key, row.position);
        }

        // 2) Build VIRTUAL page (requested mode).
        const virtualPage = await builder(request);

        // 3) Inject movement into total_supertext on the virtual rows.
        for (const row of virtualPage.rows) {
            const realPos = realPositionByKey.get(row.key);

            if (!realPos || !row.position) {
                // No real baseline for this user → no movement.
                row.movement_from_real = null;
                continue;
            }

            const diff = realPos - row.position;

            if (Number.isNaN(diff)) {
                row.movement_from_real = null;
            } else if (diff > 0) {
                // Moved up in virtual vs real.
                row.movement_from_real = `+${diff}`;
            } else if (diff < 0) {
                // Moved down.
                row.movement_from_real = `${diff}`;
            } else {
                // Same position.
                row.movement_from_real = null;
            }
        }

        return virtualPage;
    }

    private async buildTotalScorePage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const {is_virtual, user_id} = request;
        const decimals = StatisticsService.TOTAL_SCORE_DECIMALS;

        const seasonsRaw = await this.repo.getSeasonsForTotalScore(is_virtual);
        const seasons = this.mapScoreSeasonWeights("total_score", seasonsRaw);

        const userSeasonRows = await this.repo.getUserSeasonScoresForTotalScore(
            is_virtual,
        );

        const userMap = this.aggregateUserSeasonValues(
            seasons,
            userSeasonRows,
            (value) => this.formatScore(value, decimals),
        );

        const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
            if (b.totalValue !== a.totalValue) {
                return b.totalValue - a.totalValue;
            }
            return a.displayName.localeCompare(b.displayName);
        });

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
                total_value: this.formatScore(u.totalValue, decimals),
                total_raw_value: u.totalValue,
                movement_from_real: null,
                per_season_values: u.perSeasonValues,
            });

            lastTotal = u.totalValue;
            lastPosition = position;
        });

        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        // Add season_open + is_virtual metadata to seasons + per-season cells
        const seasonsDto: StatsSeasonDto[] = await this.buildSeasonMeta(
            seasons,
            rows,
            is_virtual,
        );

        const dto: StatsPageDto = {
            page_title: "De rijkste rover",
            page_subtitle: "Behaalde score over alle seizoenen",

            supports_virtual: true,
            is_virtual,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: true,
            total_column_width_factor: 1.3,
            number_decimals: decimals,

            left_header: {
                position_label: "#",
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
        const decimals = StatisticsService.EAGLES_DECIMALS;

        const seasonsRaw = await this.repo.getSeasonsForTotalScore(is_virtual);
        const seasons = this.mapScoreSeasonWeights("eagles", seasonsRaw);

        const userSeasonRows = await this.repo.getUserSeasonScoresForTotalScore(
            is_virtual,
        );

        const userMap = this.aggregateUserSeasonValues(
            seasons,
            userSeasonRows,
            (value) => this.formatScore(value, decimals),
        );

        const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
            if (b.totalValue !== a.totalValue) {
                return b.totalValue - a.totalValue;
            }
            return a.displayName.localeCompare(b.displayName);
        });

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
                total_value: this.formatScore(u.totalValue, decimals),
                total_raw_value: u.totalValue,
                movement_from_real: null,
                per_season_values: u.perSeasonValues,
            });

            lastTotal = u.totalValue;
            lastPosition = position;
        });

        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = await this.buildSeasonMeta(
            seasons,
            rows,
            is_virtual,
        );

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
            number_decimals: decimals,

            left_header: {
                position_label: "#",
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

        const seasonsRaw = await this.repo.getSeasonsForTotalPoints(is_virtual);
        const seasons = this.mapSeasonWeights(seasonsRaw);

        const userSeasonRows = await this.repo.getUserSeasonPointsForTotalPoints(
            is_virtual,
        );

        const userMap = this.aggregateUserSeasonValues(
            seasons,
            userSeasonRows,
            (value) => this.formatPoints(value),
        );

        const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
            if (b.totalValue !== a.totalValue) {
                return b.totalValue - a.totalValue;
            }
            return a.displayName.localeCompare(b.displayName);
        });

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
                total_raw_value: u.totalValue,
                movement_from_real: null,
                per_season_values: u.perSeasonValues,
            });

            lastTotal = u.totalValue;
            lastPosition = position;
        });

        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = await this.buildSeasonMeta(
            seasons,
            rows,
            is_virtual,
        );

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
            number_decimals: 0,

            left_header: {
                position_label: "#",
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

        const currentSeasonId = await this.repo.getCurrentSeasonId();
        if (!currentSeasonId) {
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
                number_decimals: 0,

                left_header: {
                    position_label: "#",
                    name_label: "",
                    total_label: "Totaal",
                },

                seasons: [],
                rows: [],
            };
            return dto;
        }

        const seasonsRaw = await this.repo.getSeasonsForSubmissionCoverage();
        const seasons = this.mapSeasonWeights(seasonsRaw);
        const seasonIds = seasons.map((s) => s.seasonId);

        const mainQuestionCountsRaw =
            await this.repo.getMainQuestionCountsForSeasons(seasonIds);
        const mainQuestionsPerSeason = new Map<number, number>();
        mainQuestionCountsRaw.forEach((row) => {
            mainQuestionsPerSeason.set(row.season_id, row.main_questions);
        });

        const participants = await this.repo.getParticipantsForSeason(
            currentSeasonId,
        );
        const participantIds = new Set(participants.map((p) => p.user_id));
        const participantIdList = participants.map((p) => p.user_id);

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

        const rowsRaw = await this.repo.getUserSeasonSubmissionCounts();

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

        for (const row of rowsRaw) {
            if (!participantIds.has(row.user_id)) continue;
            if (!userMap.has(row.user_id)) continue;
            if (!seasonIds.includes(row.season_id)) continue;

            const user = userMap.get(row.user_id)!;
            user.perSeasonCounts[row.season_id] = row.score;
        }

        type CoverageUser = {
            userId: number;
            displayName: string;
            totalSubmitted: number;
            totalPossible: number;
            coverageRatio: number;
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

                if (userSeasons.has(sid)) {
                    const mainQs = mainQuestionsPerSeason.get(sid) ?? 0;
                    totalPossible += mainQs;
                }

                perSeasonValues[sid] = {
                    value: count.toString(),
                    raw_value: count,
                    supertext: null,
                    season_open: false,
                    is_virtual: false,
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

        coverageUsers.sort((a, b) => {
            if (mode === "ups_missed") {
                if (b.coverageRatio !== a.coverageRatio) {
                    return b.coverageRatio - a.coverageRatio;
                }
                if (b.totalSubmitted !== a.totalSubmitted) {
                    return b.totalSubmitted - a.totalSubmitted;
                }
                return a.displayName.localeCompare(b.displayName);
            } else {
                if (b.totalSubmitted !== a.totalSubmitted) {
                    return b.totalSubmitted - a.totalSubmitted;
                }
                if (b.totalPossible !== a.totalPossible) {
                    return b.totalPossible - a.totalPossible;
                }
                return a.displayName.localeCompare(b.displayName);
            }
        });

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
                total_raw_value: primary,
                movement_from_real: null,
                per_season_values: u.perSeasonValues,
            });

            lastPrimary = primary;
            lastSecondary = secondary;
            lastPosition = position;
        });

        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = await this.buildSeasonMeta(
            seasons,
            rows,
            false,
            currentSeasonId,
        );

        const dto: StatsPageDto = {
            page_title: mode === "ups_missed" ? "Oeps gemist" : "De lange adem",
            page_subtitle:
                mode === "ups_missed"
                    ? "Ingezonden vragen / alle vragen"
                    : "Meeste ingezonden vragen",

            supports_virtual: false,
            is_virtual: false,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: false,
            total_column_width_factor: 1.3,
            number_decimals: 0,

            left_header: {
                position_label: "#",
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
     * - Total metric per user (over all seasons on this page), with participation factor:
     *       raw_efficiency_total = (total_score > 0)
     *                                ? total_points / total_score
     *                                : 0
     *
     *       participation_factor = user_active_seasons / all_seasons_on_page
     *         - user_active_seasons: seasons where user appears in users_season
     *                                among the seasons for this page
     *         - all_seasons_on_page: seasons shown on this page (from getSeasonsForTotalScore)
     *
     *       adjusted_efficiency_total = raw_efficiency_total * participation_factor
     *
     * - Ordering:
     *     1) Highest adjusted_efficiency_total first (most efficient at the top)
     *     2) If equal, higher total_score first
     *     3) If still equal, alphabetical by name
     *
     * - Display:
     *     - total_value = adjusted_efficiency_total formatted with 2 decimals
     *     - per-season cell = efficiency_s with 2 decimals (UNSCALED)
     *     - When score = 0 → 0.00
     *     - No supertext
     */
    private async buildMostEfficientPage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const {is_virtual, user_id} = request;
        const decimals = StatisticsService.EFFICIENCY_DECIMALS;

        const seasonsRaw = await this.repo.getSeasonsForTotalScore(is_virtual);
        const seasons: SeasonWeight[] = seasonsRaw.map((row) => ({
            seasonId: row.season_id,
            label: row.season_label,
            weightFactor: 1.0,
        }));
        const seasonIds = seasons.map((s) => s.seasonId);

        const rowsRaw: EfficiencyUserSeasonRow[] =
            await this.repo.getUserSeasonPointsAndScoresForEfficiency(is_virtual);

        type UserAgg = {
            userId: number;
            displayName: string;
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

            const existing = user.perSeason.get(seasonId) ?? {points: 0, score: 0};
            existing.points += row.points ?? 0;
            existing.score += row.score ?? 0;
            user.perSeason.set(seasonId, existing);

            user.totalPoints += row.points ?? 0;
            user.totalScore += row.score ?? 0;
        }

        const userIds = Array.from(userMap.keys());
        const totalSeasonCount = seasonIds.length > 0 ? seasonIds.length : 1;

        const participationRows = await this.repo.getSeasonParticipationForUsers(
            userIds,
            seasonIds,
        );
        const activeSeasonsPerUser = new Map<number, number>();
        for (const row of participationRows) {
            const current = activeSeasonsPerUser.get(row.user_id) ?? 0;
            activeSeasonsPerUser.set(row.user_id, current + 1);
        }

        const usersWithEfficiency = Array.from(userMap.values()).map((user) => {
            const perSeasonValues: Record<number, StatsPerSeasonValueDto> = {};

            seasonIds.forEach((sid) => {
                const data = user.perSeason.get(sid);
                if (!data) {
                    perSeasonValues[sid] = {
                        value: null,
                        raw_value: null,
                        supertext: null,
                        season_open: false,
                        is_virtual: false,
                    };
                    return;
                }

                const {points, score} = data;
                const eff = score > 0 ? points / score : 0;
                perSeasonValues[sid] = {
                    value: eff.toFixed(decimals),
                    raw_value: eff,
                    supertext: null,
                    season_open: false,
                    is_virtual: false,
                };
            });

            const rawTotalEff =
                user.totalScore > 0 ? user.totalPoints / user.totalScore : 0;

            const activeSeasons = activeSeasonsPerUser.get(user.userId) ?? 0;
            const participationFactor =
                totalSeasonCount > 0 ? activeSeasons / totalSeasonCount : 0;

            const adjustedTotalEff = rawTotalEff * participationFactor;

            return {
                userId: user.userId,
                displayName: user.displayName,
                totalEffRaw: rawTotalEff,
                totalEffAdjusted: adjustedTotalEff,
                totalScore: user.totalScore,
                perSeasonValues,
            };
        });

        usersWithEfficiency.sort((a, b) => {
            if (b.totalEffAdjusted !== a.totalEffAdjusted) {
                return b.totalEffAdjusted - a.totalEffAdjusted;
            }
            if (b.totalScore !== a.totalScore) {
                return b.totalScore - a.totalScore;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        const rows: StatsRowDto[] = [];
        let lastEff: number | null = null;
        let lastScore: number | null = null;
        let lastPosition = 0;

        usersWithEfficiency.forEach((u, index) => {
            const isTie =
                lastEff !== null &&
                lastScore !== null &&
                u.totalEffAdjusted === lastEff &&
                u.totalScore === lastScore;

            const position = isTie ? lastPosition : index + 1;

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: u.totalEffAdjusted.toFixed(decimals),
                total_raw_value: u.totalEffAdjusted,
                movement_from_real: null,
                per_season_values: u.perSeasonValues,
            });

            lastEff = u.totalEffAdjusted;
            lastScore = u.totalScore;
            lastPosition = position;
        });

        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = await this.buildSeasonMeta(
            seasons,
            rows,
            is_virtual,
        );

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
            number_decimals: decimals,

            left_header: {
                position_label: "#",
                name_label: "",
                total_label: "Totaal",
            },

            seasons: seasonsDto,
            rows,
        };

        return dto;
    }

    /**
     * "On the Throne" page:
     *
     * Title:    "Op de troon"
     * Subtitle: "Aantal dagen op eerste plaats"
     *
     * Semantics:
     * - Only league_id = 1, virtual = 0.
     * - Uses classification table only.
     * - Per season, we walk sequences in insertion order and:
     *     • For each snapshot, we look at all users with seed = 1.
     *     • We compute full days between this snapshot and the next snapshot
     *       in the same season (TIMESTAMPDIFF(DAY, insertion, next_insertion)).
     *     • Each user with seed = 1 in the current snapshot receives that many days.
     * - Last snapshot of a season does not accrue days beyond its insertion
     *   (no cross-season carry; we never pair into the next season).
     * - Ties: if multiple users share seed = 1, each gets the full day count.
     *
     * Display:
     * - Seasons: all seasons that have at least one classification row for
     *   league_id = 1, virtual = 0.
     * - Rows: ALL users from the users table (not just participants).
     * - Per-season cells: integer days as string; "0" when no days on throne.
     * - Total column: sum of days across all seasons (integer string).
     * - Ordering:
     *     1) Highest total days first
     *     2) If equal, alphabetical by display name.
     *
     * Virtual:
     * - No virtual support: supports_virtual = false, is_virtual = false.
     */
    private async buildOnThronePage(
        request: StatisticsPageRequestDto,
    ): Promise<StatsPageDto> {
        const {user_id} = request;

        const seasonsRaw = await this.repo.getSeasonsForOnThrone();
        if (seasonsRaw.length === 0) {
            const empty: StatsPageDto = {
                page_title: "Op de troon",
                page_subtitle: "Aantal dagen op eerste plaats",

                supports_virtual: false,
                is_virtual: false,

                personal_user_id: null,
                personal_user_position: null,
                personal_user_name: null,
                personal_row_key: null,

                has_super: false,
                total_column_width_factor: 1.3,
                number_decimals: 0,

                left_header: {
                    position_label: "#",
                    name_label: "",
                    total_label: "Totaal",
                },

                seasons: [],
                rows: [],
            };
            return empty;
        }

        const seasons: SeasonWeight[] = this.mapSeasonWeights(seasonsRaw);
        const seasonIds = seasons.map((s) => s.seasonId);

        const throneRows = await this.repo.getOnThroneUserSeasonDays();

        const allUsers = await this.repo.getAllUsersBasic();

        type OnThroneUserAgg = {
            userId: number;
            displayName: string;
            totalDays: number;
            perSeasonDays: Record<number, number>;
        };

        const userMap = new Map<number, OnThroneUserAgg>();

        for (const u of allUsers) {
            const parts = [u.firstname, u.infix, u.lastname]
                .map((v) => (v ?? "").trim())
                .filter((v) => v.length > 0);

            const displayName = parts.join(" ") || `User ${u.user_id}`;

            const perSeasonDays: Record<number, number> = {};
            seasonIds.forEach((sid) => {
                perSeasonDays[sid] = 0;
            });

            userMap.set(u.user_id, {
                userId: u.user_id,
                displayName,
                totalDays: 0,
                perSeasonDays,
            });
        }

        for (const row of throneRows) {
            if (!seasonIds.includes(row.season_id)) {
                continue;
            }

            if (!userMap.has(row.user_id)) {
                const perSeasonDays: Record<number, number> = {};
                seasonIds.forEach((sid) => {
                    perSeasonDays[sid] = 0;
                });

                userMap.set(row.user_id, {
                    userId: row.user_id,
                    displayName: `User ${row.user_id}`,
                    totalDays: 0,
                    perSeasonDays,
                });
            }

            const user = userMap.get(row.user_id)!;

            const days = Number(row.days_on_throne ?? 0);

            user.perSeasonDays[row.season_id] =
                (user.perSeasonDays[row.season_id] ?? 0) + days;
            user.totalDays += days;
        }

        const userAggs = Array.from(userMap.values());

        userAggs.sort((a, b) => {
            if (b.totalDays !== a.totalDays) {
                return b.totalDays - a.totalDays;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        const rows: StatsRowDto[] = [];
        let lastTotal: number | null = null;
        let lastPosition = 0;

        userAggs.forEach((u, index) => {
            const isTie = lastTotal !== null && u.totalDays === lastTotal;
            const position = isTie ? lastPosition : index + 1;

            const perSeasonValues: Record<number, StatsPerSeasonValueDto> = {};
            seasonIds.forEach((sid) => {
                const days = Number(u.perSeasonDays[sid] ?? 0);
                perSeasonValues[sid] = {
                    value: days.toString(),
                    raw_value: days,
                    supertext: null,
                    season_open: false,
                    is_virtual: false,
                };
            });

            const totalDays = Number(u.totalDays ?? 0);

            rows.push({
                key: String(u.userId),
                position,
                display_name: u.displayName,
                total_value: totalDays.toString(),
                total_raw_value: totalDays,
                movement_from_real: null,
                per_season_values: perSeasonValues,
            });

            lastTotal = u.totalDays;
            lastPosition = position;
        });

        const personalRow =
            user_id != null
                ? rows.find((r) => Number(r.key) === user_id)
                : undefined;

        const seasonsDto: StatsSeasonDto[] = await this.buildSeasonMeta(
            seasons,
            rows,
            false,
        );

        const dto: StatsPageDto = {
            page_title: "Op de troon",
            page_subtitle: "Aantal dagen op eerste plaats",

            supports_virtual: false,
            is_virtual: false,

            personal_user_id: personalRow ? user_id : null,
            personal_user_position: personalRow ? personalRow.position : null,
            personal_user_name: personalRow ? personalRow.display_name : null,
            personal_row_key: personalRow ? personalRow.key : null,

            has_super: false,
            total_column_width_factor: 1.3,
            number_decimals: 0,

            left_header: {
                position_label: "#",
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
            weightFactor: row.weight_percent / 100,
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

        const pattern: number[] = [
            0.8,
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
                continue;
            }

            const weight = seasonWeightMap.get(seasonId) ?? 1.0;
            const weighted = row.score * weight;

            if (!userMap.has(row.user_id)) {
                const perSeasonValues: Record<number, StatsPerSeasonValueDto> = {};
                seasonIds.forEach((id) => {
                    perSeasonValues[id] = {
                        value: null,
                        raw_value: null,
                        supertext: null,
                        season_open: false,
                        is_virtual: false,
                    };
                });

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
                ...user.perSeasonValues[seasonId],
                value: formatValue(row.score),
                raw_value: row.score,
                supertext:
                    row.final_position != null ? String(row.final_position) : null,
            };
        }

        for (const user of userMap.values()) {
            seasonIds.forEach((id) => {
                if (!user.perSeasonValues[id]) {
                    user.perSeasonValues[id] = {
                        value: null,
                        raw_value: null,
                        supertext: null,
                        season_open: false,
                        is_virtual: false,
                    };
                }
            });
        }

        return userMap;
    }

    private formatScore(value: number, decimals: number): string {
        return value.toFixed(decimals);
    }

    private formatPoints(value: number): string {
        return Math.round(value).toString();
    }

    /**
     * Helper to attach:
     * - season_open flag on each StatsSeasonDto
     * - season_open + is_virtual flags on every per-season cell in rows
     *
     * season_open:
     * - true  → this season is the CURRENT open season in the DB (closed = '0')
     * - false → any other season, or when no current season exists
     *
     * is_virtual:
     * - mirrors the stats page mode for now (no per-season mixing)
     */
    private async buildSeasonMeta(
        seasons: SeasonWeight[],
        rows: StatsRowDto[],
        isVirtual: boolean,
        currentSeasonId?: number | null,
    ): Promise<StatsSeasonDto[]> {
        let openId = currentSeasonId;
        if (openId === undefined) {
            openId = await this.repo.getCurrentSeasonId();
        }

        const seasonsDto: StatsSeasonDto[] = seasons.map((s) => ({
            season_id: s.seasonId,
            season_label: s.seasonId.toString(),
            season_open: openId != null && s.seasonId === openId ? "1" : "0",
        }));

        const seasonIds = seasons.map((s) => s.seasonId);

        for (const row of rows) {
            for (const sid of seasonIds) {
                const cell = row.per_season_values[sid];
                if (!cell) continue;

                cell.season_open = openId != null && sid === openId;
                cell.is_virtual = isVirtual;
            }
        }

        return seasonsDto;
    }


    /**
     * Bullseye statistics:
     * - Separate entry point, NOT part of getStatisticsPage().
     * - Lists, per season, all bundles where a user scored exactly 20 points
     *   across all questions in that bundle (same groupcode).
     *
     * Dataset semantics:
     * - The dataset (which bullseyes are returned) is the SAME for virtual and non-virtual.
     * - The repo always returns ALL bullseyes; the "main_virtual" flag on each bundle
     *   indicates whether the main question was virtual.
     *
     * Counters we expose:
     * - number_of_20
     *     → running count of REAL (non-virtual) bullseyes per user over time
     *       across all seasons; virtual bundles NEVER increment this.
     * - number_of_20_virtual
     *     → running count of VIRTUAL bullseyes per user, but ONLY inside the
     *       CURRENT season; other seasons always have 0 here.
     *
     * Result:
     * - A bundle whose main question is virtual:
     *     • NEVER contributes to number_of_20 (so it never looks real).
     *     • contributes to number_of_20_virtual only in the current season.
     * - A bundle whose main question is real:
     *     • increments number_of_20,
     *     • NEVER increments number_of_20_virtual.
     */
    async getBullseyeStats(request: BullseyeRequestDto): Promise<BullseyeStatsDto> {
        const {user_id} = request;

        // IMPORTANT:
        // The dataset (which bullseyes are returned) is the SAME for virtual and non-virtual.
        const rows: BullseyeRow[] = await this.repo.getBullseyeRows();

        // "Current season" is the open season (closed = 0) with highest id.
        const currentSeasonId = await this.repo.getCurrentSeasonId();

        // Helper: normalize main_virtual to 0/1 (DB can return "0"/"1" as strings).
        const normalizeMainVirtual = (value: unknown): number => {
            if (value === 1 || value === "1" || value === true) {
                return 1;
            }
            return 0;
        };

        // No bullseyes at all → early exit with empty structure.
        if (!rows.length) {
            let personalDisplayName: string | null = null;

            if (user_id != null) {
                const allUsers = await this.repo.getAllUsersBasic();
                const u = allUsers.find((x) => x.user_id === user_id);
                if (u) {
                    const parts = [u.firstname, u.infix, u.lastname]
                        .map((v) => (v ?? "").trim())
                        .filter((v) => v.length > 0);
                    personalDisplayName = parts.join(" ") || `User ${u.user_id}`;
                }
            }

            const empty: BullseyeStatsDto = {
                user_id,
                is_virtual: false,
                seasons: [],
                personal_bar: {
                    user_id: user_id ?? null,
                    display_name: personalDisplayName,
                    number_of_bullseyes: 0,
                    number_of_virtual_bullseyes: 0,
                },
            };
            return empty;
        }

        // Group raw rows into bundle objects keyed by (season, bet, groupcode, user)
        type BundleKey = string;
        type BundleAgg = {
            season_id: number;
            season_label: string;
            bet_id: number;
            bet_label: string;
            groupcode: number;
            user_id: number;
            display_name: string;
            main_virtual: number;
            questions: Array<{
                question_id: number;
                question_name: string;
                is_main: boolean;
                is_bonus: boolean;
                is_first_bonus: boolean;
                solution_label: string | null;
                solution_flag: string | null;
                solution_team: string | null;
                solution_fg: string | null;
                solution_bg: string | null;
                show_teams: boolean | null;
            }>;
            number_of_20: number;
            number_of_20_virtual: number;
            /**
             * Per-season running index of bullseyes for this user within this season.
             * Used only for ordering inside a season; not exposed in the payload.
             */
            season_bullseye_index: number;
        };

        const bundlesByKey = new Map<BundleKey, BundleAgg>();

        for (const row of rows) {
            const key: BundleKey = [
                row.season_id,
                row.bet_id,
                row.groupcode,
                row.user_id,
            ].join(":");

            if (!bundlesByKey.has(key)) {
                const parts = [row.firstname, row.infix, row.lastname]
                    .map((v) => (v ?? "").trim())
                    .filter((v) => v.length > 0);
                const displayName = parts.join(" ") || `User ${row.user_id}`;

                bundlesByKey.set(key, {
                    season_id: row.season_id,
                    season_label: row.season_label,
                    bet_id: row.bet_id,
                    bet_label: row.bet_label,
                    groupcode: row.groupcode,
                    user_id: row.user_id,
                    display_name: displayName,
                    main_virtual: normalizeMainVirtual(row.main_virtual),
                    questions: [],
                    number_of_20: 0,
                    number_of_20_virtual: 0,
                    season_bullseye_index: 0,
                });
            }

            const bundle = bundlesByKey.get(key)!;

            bundle.questions.push({
                question_id: row.question_id,
                question_name: row.question_label,
                is_main: row.is_main === 1 || row.is_main === "1",
                is_bonus: row.is_bonus === 1 || row.is_bonus === "1",
                is_first_bonus:
                    row.is_first_bonus === 1 || row.is_first_bonus === "1",
                // Use the user's answer label as a default solution_label;
                // will be enriched with official solution/listitem metadata below.
                solution_label: row.answer_label ?? null,
                solution_flag: null,
                solution_team: null,
                solution_fg: null,
                solution_bg: null,
                show_teams: null,
            });
        }

        // Enrich questions with official solution + listitem metadata
        const allQuestionIds: number[] = [];
        for (const bundle of bundlesByKey.values()) {
            for (const q of bundle.questions) {
                allQuestionIds.push(q.question_id);
            }
        }
        const uniqueQuestionIds = Array.from(new Set(allQuestionIds));

        if (uniqueQuestionIds.length > 0) {
            const solutionRows =
                await this.solutionsRepo.getSolutionsWithListMetaForQuestionIds(
                    uniqueQuestionIds,
                );

            const solutionByQid = new Map<number,
                {
                    result: string | null;
                    item_label: string | null;
                    country_code: string | null;
                    team_abbr: string | null;
                    team_fg: string | null;
                    team_bg: string | null;
                    show_teams: unknown;
                }>();

            for (const r of solutionRows) {
                solutionByQid.set(r.question_id, {
                    result: r.result ?? null,
                    item_label: r.item_label ?? null,
                    country_code: r.country_code ?? null,
                    team_abbr: r.team_abbr ?? null,
                    team_fg: r.team_fg ?? null,
                    team_bg: r.team_bg ?? null,
                    show_teams: (r as any).show_teams ?? null,
                });
            }

            for (const bundle of bundlesByKey.values()) {
                for (const q of bundle.questions) {
                    const meta = solutionByQid.get(q.question_id);
                    if (!meta) {
                        continue;
                    }

                    // Prefer listitem label; fall back to stored result; otherwise keep existing label.
                    let label = q.solution_label;
                    if (meta.item_label && meta.item_label.trim().length > 0) {
                        label = meta.item_label;
                    } else if (
                        (!label || label.trim().length === 0) &&
                        meta.result &&
                        meta.result.trim().length > 0
                    ) {
                        label = meta.result;
                    }

                    q.solution_label = label ?? null;
                    q.solution_flag = meta.country_code ?? null;
                    q.solution_team = meta.team_abbr ?? null;
                    q.solution_fg = meta.team_fg ?? null;
                    q.solution_bg = meta.team_bg ?? null;

                    if (meta.show_teams !== null && meta.show_teams !== undefined) {
                        const v = meta.show_teams;
                        q.show_teams =
                            v === true ||
                            v === 1 ||
                            v === "1";
                    } else {
                        q.show_teams = null;
                    }
                }
            }
        }

        // Sort questions inside each bundle by:
        // - main first, then by question_id
        for (const bundle of bundlesByKey.values()) {
            bundle.questions.sort((a, b) => {
                if (a.is_main !== b.is_main) {
                    return a.is_main ? -1 : 1;
                }
                return a.question_id - b.question_id;
            });
        }

        // Convert bundles map to array and sort chronologically:
        // season_id ASC, bet_id ASC, groupcode ASC, user_id ASC
        const bundles: BundleAgg[] = Array.from(bundlesByKey.values()).sort(
            (a, b) => {
                if (a.season_id !== b.season_id) {
                    return a.season_id - b.season_id;
                }
                if (a.bet_id !== b.bet_id) {
                    return a.bet_id - b.bet_id;
                }
                if (a.groupcode !== b.groupcode) {
                    return a.groupcode - b.groupcode;
                }
                if (a.user_id !== b.user_id) {
                    return a.user_id - b.user_id;
                }
                return 0;
            },
        );

        // Running counters:
        // realCountByUser   → ONLY non-virtual bullseyes (main_virtual = 0).
        // virtualCountByUser→ ONLY virtual bullseyes (main_virtual = 1) in CURRENT season.
        const realCountByUser = new Map<number, number>();
        const virtualCountByUser = new Map<number, number>();
        // Per-season running count per user (used only for ordering within a season)
        const perSeasonCountByUser = new Map<string, number>();

        for (const bundle of bundles) {
            const uid = bundle.user_id;

            // 1) REAL counter (global over all seasons, only main_virtual = 0).
            let realCount = realCountByUser.get(uid) ?? 0;
            if (bundle.main_virtual === 0) {
                realCount += 1;
                realCountByUser.set(uid, realCount);
            }
            bundle.number_of_20 = realCount;

            // 2) VIRTUAL counter (only current season + main_virtual = 1).
            let virtualCount = virtualCountByUser.get(uid) ?? 0;
            if (
                currentSeasonId != null &&
                bundle.season_id === currentSeasonId &&
                bundle.main_virtual === 1
            ) {
                virtualCount += 1;
                virtualCountByUser.set(uid, virtualCount);
                bundle.number_of_20_virtual = virtualCount;
            } else {
                // Outside current season or non-virtual → no virtual icon.
                bundle.number_of_20_virtual = 0;
            }

            // 3) Per-season running total (for ordering inside a season).
            //    Here we count ALL bullseyes (real + virtual) for that season/user.
            const seasonKey = `${bundle.season_id}:${uid}`;
            const prevSeasonTotal = perSeasonCountByUser.get(seasonKey) ?? 0;
            const newSeasonTotal = prevSeasonTotal + 1;
            perSeasonCountByUser.set(seasonKey, newSeasonTotal);
            bundle.season_bullseye_index = newSeasonTotal;
        }

        // Group bundles per season (output seasons DESC as requested).
        const seasonsMap = new Map<number,
            { label: string; bullseyes: BundleAgg[] }>();

        for (const b of bundles) {
            if (!seasonsMap.has(b.season_id)) {
                seasonsMap.set(b.season_id, {
                    label: b.season_label,
                    bullseyes: [],
                });
            }
            seasonsMap.get(b.season_id)!.bullseyes.push(b);
        }

        const seasonsSortedDesc = Array.from(seasonsMap.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([seasonId, val]) => {
                // Per-season:
                // 1) Users with most bullseyes in this season first.
                // 2) Within a user: newest bullseye first (highest season_bullseye_index).
                const perUserSeasonCount = new Map<number, number>();
                for (const b of val.bullseyes) {
                    const current = perUserSeasonCount.get(b.user_id) ?? 0;
                    perUserSeasonCount.set(b.user_id, current + 1);
                }

                const sortedBullseyes = val.bullseyes
                    .slice()
                    .sort((a, b) => {
                        const aCount = perUserSeasonCount.get(a.user_id) ?? 0;
                        const bCount = perUserSeasonCount.get(b.user_id) ?? 0;

                        // 1) Users with most bullseyes in this season first
                        if (bCount !== aCount) {
                            return bCount - aCount;
                        }

                        // 2) Same user: newest → oldest within this season
                        if (a.user_id === b.user_id) {
                            return b.season_bullseye_index - a.season_bullseye_index;
                        }

                        // 3) Different users with same season-count:
                        //    stable, readable order by display name
                        return a.display_name.localeCompare(b.display_name);
                    });

                const bullseyeDtos = sortedBullseyes.map((b) => ({
                    user_id: b.user_id,
                    display_name: b.display_name,
                    number_of_20: b.number_of_20,
                    number_of_20_virtual: b.number_of_20_virtual,
                    main_is_virtual: b.main_virtual,
                    bundle: {
                        event_id: b.bet_id,
                        event_name: b.bet_label,
                        questions: b.questions.map((q) => ({
                            question_id: q.question_id,
                            question_name: q.question_name,
                            is_main: q.is_main,
                            is_bonus: q.is_bonus,
                            is_first_bonus: q.is_first_bonus,
                            solution: {
                                solution_flag: q.solution_flag,
                                solution_team: q.solution_team,
                                solution_label: q.solution_label,
                                solution_fg: q.solution_fg,
                                solution_bg: q.solution_bg,
                                show_teams: q.show_teams,
                            },
                        })),
                    },
                }));

                return {
                    season_id: seasonId,
                    season_label: val.label,
                    bullseyes: bullseyeDtos,
                };
            });

        // Personal bar:
        let personalDisplayName: string | null = null;
        let personalTotal = 0;
        let personalVirtual = 0;

        if (user_id != null) {
            // Name: from bundles if present; otherwise from users table.
            const anyBundle = bundles.find((b) => b.user_id === user_id);
            if (anyBundle) {
                personalDisplayName = anyBundle.display_name;
            } else {
                const allUsers = await this.repo.getAllUsersBasic();
                const u = allUsers.find((x) => x.user_id === user_id);
                if (u) {
                    const parts = [u.firstname, u.infix, u.lastname]
                        .map((v) => (v ?? "").trim())
                        .filter((v) => v.length > 0);
                    personalDisplayName = parts.join(" ") || `User ${u.user_id}`;
                }
            }

            // Personal total = ONLY real bullseyes.
            personalTotal = realCountByUser.get(user_id) ?? 0;

            // Personal virtual = ONLY virtual bullseyes in current season.
            if (currentSeasonId != null) {
                personalVirtual = virtualCountByUser.get(user_id) ?? 0;
            } else {
                personalVirtual = 0;
            }
        }

        const dto: BullseyeStatsDto = {
            user_id,
            is_virtual: false,
            seasons: seasonsSortedDesc,
            personal_bar: {
                user_id: user_id ?? null,
                display_name: personalDisplayName,
                number_of_20: personalTotal,
                number_of_20_virtual: personalVirtual,
            },
        };

        return dto;
    }

    /**
     * Medal table:
     *
     * Endpoint: POST /api/v1/statistics/medals
     *
     * Title:    "Medaillespiegel"
     * Subtitle: "Bol goud, Hoed zilver, rest brons, Onder ons ivoor"
     *
     * Data sources:
     * - Real league medals (gold/silver/bronze) from "winner" table (closed seasons).
     * - Virtual league medals from "classification" (current open season, virtual = 0,
     *   latest sequence per league, all users with seed = 1).
     * - Onder Ons (ivory) from "amongus" table:
     *     • all seasons → always REAL medals (no virtual amongus).
     *
     * Virtual toggle:
     * - is_virtual = false → only real medals (winner + all amongus).
     * - is_virtual = true  → real medals + all virtual medals
     *                        (open-season classification seed 1 per league).
     *
     * Layout mapping:
     * - rows[] (per user) drives:
     *     • main table row (display_name + totals.* + position).
     *     • expandable panel:
     *         seasons[].season_label (gray line)
     *         seasons[].prizes[]:
     *             prize_label (text)
     *             kind + is_virtual + league_icon/amongus_label for icon/color in FE.
     *
     * Movement:
     * - In virtual mode, each row includes movement_from_real:
     *     real_position - virtual_position
     *   Positive = user moved up compared to the real-only ranking.
     *   Negative = user moved down.
     *   Null in real mode.
     */
    async getMedalsPage(request: MedalsRequestDto): Promise<MedalsPageDto> {
        const { is_virtual } = request;

        // Current open season id (or null if none).
        const currentSeasonId = await this.repo.getCurrentSeasonId();

        const [realLeagueRows, amongUsRows, allUsers] = await Promise.all([
            this.repo.getRealLeagueMedals(),
            this.repo.getAmongUsPrizes(),
            this.repo.getAllUsersBasic(),
        ]);

        const formatDisplayName = (
            firstname: string,
            infix: string | null,
            lastname: string,
            userId: number,
        ): string => {
            const parts = [firstname, infix, lastname]
                .map((v) => (v ?? "").trim())
                .filter((v) => v.length > 0);
            return parts.join(" ") || `User ${userId}`;
        };

        type RawMedalPrize = {
            userId: number;
            displayName: string;
            seasonId: number;
            seasonLabel: string;
            isVirtual: boolean;
            kind: MedalKind;
            prizeLabel: string;
            leagueId: number | null;
            leagueIcon: string | null;
            amongusLabel: string | null;
        };

        const rawPrizes: RawMedalPrize[] = [];

        // ---------------------------------------------------------
        // 1) Real league medals from "winner" (closed seasons only)
        // ---------------------------------------------------------
        for (const row of realLeagueRows) {
            const kind: MedalKind =
                row.league_id === 1
                    ? "gold"
                    : row.league_id === 2
                        ? "silver"
                        : "bronze";

            rawPrizes.push({
                userId: row.user_id,
                displayName: formatDisplayName(
                    row.firstname,
                    row.infix,
                    row.lastname,
                    row.user_id,
                ),
                seasonId: row.season_id,
                seasonLabel: row.season_label,
                isVirtual: false,
                kind,
                prizeLabel: row.league_label,
                leagueId: row.league_id,
                leagueIcon: row.league_icon,
                amongusLabel: null,
            });
        }

        // -----------------------------------------------------------------
        // 2) Virtual league medals (open season only) from classification:
        //    - season = current open season
        //    - league_id 1..10
        //    - use REAL standings (isVirtual=false) as "if season ended now"
        //    - league 1 winners cannot also win any other league (2..10)
        // -----------------------------------------------------------------
        if (currentSeasonId != null) {
            // First determine all current winners in league 1 (seed = 1).
            const { standings: league1Standings } = await classificationService.current(
                currentSeasonId,
                1,
                /* isVirtual */ false,
                "user,league,season",
            );

            const league1WinnerUserIds = new Set<number>();
            for (const r of (league1Standings as any[]) ?? []) {
                if (r.seed === 1 && r.user && typeof r.user.id === "number") {
                    league1WinnerUserIds.add(r.user.id);
                }
            }

            if (process.env.NODE_ENV !== "production") {
                console.log(
                    "[Medals] League 1 current winners for virtual exclusion:",
                    Array.from(league1WinnerUserIds),
                );
            }

            for (let leagueId = 1; leagueId <= 10; leagueId++) {
                const { standings } = await classificationService.current(
                    currentSeasonId,
                    leagueId,
                    /* isVirtual */ false,
                    "user,league,season",
                );

                const rows = (standings as any[]) ?? [];
                if (!rows.length) {
                    continue;
                }

                // Determine which rows actually get a virtual prize in this league.
                const winnerRows: any[] = [];

                if (leagueId === 1) {
                    // League 1: all seed=1 users are winners (no exclusion).
                    for (const r of rows) {
                        if (r.seed === 1 && r.user && r.league && r.season) {
                            winnerRows.push(r);
                            if (process.env.NODE_ENV !== "production") {
                                console.log(
                                    `[Medals] Virtual prize in league 1 awarded to user ${r.user.id} (${r.user.firstname} ${r.user.lastname}), seed=1.`,
                                );
                            }
                        }
                    }
                } else {
                    // Leagues 2..10: honor league 1 exclusion.
                    // 1) Log any users who would have been seed=1 here but are league 1 winners.
                    for (const r of rows) {
                        if (
                            r.seed === 1 &&
                            r.user &&
                            typeof r.user.id === "number" &&
                            league1WinnerUserIds.has(r.user.id)
                        ) {
                            if (process.env.NODE_ENV !== "production") {
                                console.log(
                                    `[Medals] Excluding user ${r.user.id} (${r.user.firstname} ${r.user.lastname}) from virtual prize in league ${leagueId} because they are seed=1 in league 1.`,
                                );
                            }
                        }
                    }

                    // 2) Among all standings in this league, find the best eligible user(s)
                    //    that are NOT league 1 winners.
                    const eligible = rows.filter(
                        (r) =>
                            r.user &&
                            typeof r.user.id === "number" &&
                            !league1WinnerUserIds.has(r.user.id),
                    );

                    if (!eligible.length) {
                        // No eligible user left for this league → no virtual prize.
                        if (process.env.NODE_ENV !== "production") {
                            console.log(
                                `[Medals] No eligible virtual winner in league ${leagueId} (all top users are league 1 winners).`,
                            );
                        }
                        continue;
                    }

                    // Find the smallest seed among eligible users.
                    let bestSeed = Number.POSITIVE_INFINITY;
                    for (const r of eligible) {
                        if (typeof r.seed === "number" && r.seed < bestSeed) {
                            bestSeed = r.seed;
                        }
                    }

                    // All eligible users with this bestSeed are virtual winners (handles ties).
                    for (const r of eligible) {
                        if (r.seed === bestSeed && r.user && r.league && r.season) {
                            winnerRows.push(r);
                            if (process.env.NODE_ENV !== "production") {
                                console.log(
                                    `[Medals] Virtual prize in league ${leagueId} awarded to user ${r.user.id} (${r.user.firstname} ${r.user.lastname}), seed=${r.seed}, not seed=1 in league 1.`,
                                );
                            }
                        }
                    }
                }

                // Push RawMedalPrize entries for all winnerRows in this league.
                for (const r of winnerRows) {
                    const user = r.user;
                    const league = r.league;
                    const season = r.season;

                    if (!user || !league || !season) continue;

                    const kind: MedalKind =
                        league.id === 1
                            ? "gold"
                            : league.id === 2
                                ? "silver"
                                : "bronze";

                    rawPrizes.push({
                        userId: user.id,
                        displayName: formatDisplayName(
                            user.firstname,
                            user.infix ?? null,
                            user.lastname,
                            user.id,
                        ),
                        seasonId: season.id,
                        seasonLabel: season.label,
                        isVirtual: true,
                        kind,
                        prizeLabel: league.label,
                        leagueId: league.id,
                        leagueIcon: league.icon ?? null,
                        amongusLabel: null,
                    });
                }
            }
        }

        // ---------------------------------------------------------
        // 3) Onder Ons (ivory) from "amongus" — ALWAYS REAL
        //    (no virtual amongus, even in open season)
        // ---------------------------------------------------------
        for (const row of amongUsRows) {
            rawPrizes.push({
                userId: row.user_id,
                displayName: formatDisplayName(
                    row.firstname,
                    row.infix,
                    row.lastname,
                    row.user_id,
                ),
                seasonId: row.season_id,
                seasonLabel: row.season_label,
                isVirtual: false, // explicit: Onder Ons is never virtual
                kind: "ivory",
                prizeLabel: row.amongus_label,
                leagueId: null,
                leagueIcon: null,
                amongusLabel: row.amongus_label,
            });
        }

        // ---------------------------------------------------------
        // Helper: build full rows[] for a given prize set
        // ---------------------------------------------------------
        const buildRowsForPrizes = (prizes: RawMedalPrize[]): MedalsRowDto[] => {
            // Group prizes per user.
            const prizesByUser = new Map<number, RawMedalPrize[]>();
            for (const p of prizes) {
                if (!prizesByUser.has(p.userId)) {
                    prizesByUser.set(p.userId, []);
                }
                prizesByUser.get(p.userId)!.push(p);
            }

            const rows: MedalsRowDto[] = [];

            // Build rows for ALL users (including zero-medal users)
            for (const u of allUsers) {
                const displayName = formatDisplayName(
                    u.firstname,
                    u.infix,
                    u.lastname,
                    u.user_id,
                );
                const userPrizes = prizesByUser.get(u.user_id) ?? [];

                const totals: MedalsTotalsDto = {
                    total: 0,
                    total_has_virtual: false,

                    gold: 0,
                    gold_has_virtual: false,

                    silver: 0,
                    silver_has_virtual: false,

                    bronze: 0,
                    bronze_has_virtual: false,

                    ivory: 0,
                    ivory_has_virtual: false,
                };

                for (const p of userPrizes) {
                    totals.total += 1;
                    if (p.isVirtual) {
                        totals.total_has_virtual = true;
                    }

                    switch (p.kind) {
                        case "gold":
                            totals.gold += 1;
                            if (p.isVirtual) {
                                totals.gold_has_virtual = true;
                            }
                            break;
                        case "silver":
                            totals.silver += 1;
                            if (p.isVirtual) {
                                totals.silver_has_virtual = true;
                            }
                            break;
                        case "bronze":
                            totals.bronze += 1;
                            if (p.isVirtual) {
                                totals.bronze_has_virtual = true;
                            }
                            break;
                        case "ivory":
                            totals.ivory += 1;
                            if (p.isVirtual) {
                                totals.ivory_has_virtual = true;
                            }
                            break;
                    }
                }

                // Group user prizes by season.
                const seasonsById = new Map<
                    number,
                    { seasonLabel: string; prizes: MedalsPrizeDto[] }
                    >();

                for (const p of userPrizes) {
                    if (!seasonsById.has(p.seasonId)) {
                        seasonsById.set(p.seasonId, {
                            seasonLabel: p.seasonLabel,
                            prizes: [],
                        });
                    }

                    const dtoPrize: MedalsPrizeDto = {
                        kind: p.kind,
                        prize_label: p.prizeLabel,
                        is_virtual: p.isVirtual,
                        league_id: p.leagueId,
                        league_icon: p.leagueIcon,
                        amongus_label: p.amongusLabel,
                    };

                    seasonsById.get(p.seasonId)!.prizes.push(dtoPrize);
                }

                const seasons: MedalsSeasonDto[] = Array.from(seasonsById.entries())
                    .sort((a, b) => b[0] - a[0]) // newest season first
                    .map<MedalsSeasonDto>(([seasonId, val]) => ({
                        season_id: seasonId,
                        season_label: val.seasonLabel,
                        season_open:
                            currentSeasonId != null && seasonId === currentSeasonId,
                        prizes: val.prizes,
                    }));

                rows.push({
                    user_id: u.user_id,
                    display_name: displayName,
                    totals,
                    seasons,
                    // position will be filled AFTER sorting (Olympic style ranking)
                    position: 0 as any,
                    // patched later only in virtual mode
                    movement_from_real: null,
                });
            }

            // Olympic-style ordering + position
            rows.sort((a, b) => {
                const g = b.totals.gold - a.totals.gold;
                if (g !== 0) return g;

                const s = b.totals.silver - a.totals.silver;
                if (s !== 0) return s;

                const br = b.totals.bronze - a.totals.bronze;
                if (br !== 0) return br;

                const iv = b.totals.ivory - a.totals.ivory;
                if (iv !== 0) return iv;

                const t = b.totals.total - a.totals.total;
                if (t !== 0) return t;

                return a.display_name.localeCompare(b.display_name);
            });

            let lastKey: string | null = null;
            let currentRank = 0;

            rows.forEach((row, index) => {
                const key = [
                    row.totals.gold,
                    row.totals.silver,
                    row.totals.bronze,
                    row.totals.ivory,
                ].join("|");

                if (lastKey === null || key !== lastKey) {
                    currentRank = index + 1;
                    lastKey = key;
                }

                (row as any).position = currentRank;
            });

            return rows;
        };

        // ---------------------------------------------------------
        // 4) Build both REAL and VIRTUAL rankings to compute movement
        // ---------------------------------------------------------
        const prizesReal = rawPrizes.filter((p) => !p.isVirtual);
        const prizesVirtual = rawPrizes; // real + virtual

        const rowsReal = buildRowsForPrizes(prizesReal);
        const rowsVirtual = buildRowsForPrizes(prizesVirtual);

        // Map user → real position for quick lookup
        const realPositionByUser = new Map<number, number>();
        for (const r of rowsReal) {
            realPositionByUser.set(r.user_id, r.position);
        }

        // In virtual mode, compute movement_from_real
        if (is_virtual) {
            for (const r of rowsVirtual) {
                const realPos = realPositionByUser.get(r.user_id);
                if (!realPos || !r.position) {
                    r.movement_from_real = null;
                } else {
                    // Same sign convention as classification.movement:
                    // positive = moved up, negative = moved down
                    r.movement_from_real = realPos - r.position;
                }
            }
        }

        const dto: MedalsPageDto = {
            page_title: "Medaillespiegel",
            page_subtitle: "Bol goud, Hoed zlv, rest brns, Onder ons ivoor",
            supports_virtual: true,
            is_virtual,
            rows: is_virtual ? rowsVirtual : rowsReal,
        };

        return dto;
    }

    /**
     * Palmares page:
     * - Shows all winners per season, ordered as:
     *     1) virtual winners (classification-based, current open season only)
     *     2) real league winners (winner table)
     *     3) Onder Ons winners (amongus table)
     *
     * Virtual rules:
     * - We derive virtual winners only for the CURRENT open season (season.closed = '0').
     * - Winners in league 1 cannot also be winners in any other league (2..10)
     *   in the virtual layer — same rule as the medals page.
     *
     * Real rules:
     * - Real league winners come from winner (closed seasons only).
     * - Onder Ons prizes are always treated as real (never virtual), even in open season.
     *
     * Virtual toggle:
     * - is_virtual = false → only real prizes (winner + amongus).
     * - is_virtual = true  → virtual winners + all real prizes.
     */
    async getPalmaresPage(request: PalmaresRequestDto): Promise<PalmaresPageDto> {
        const { is_virtual } = request;

        const currentSeasonId = await this.repo.getCurrentSeasonId();

        const [realLeagueRows, amongUsRows] = await Promise.all([
            this.repo.getRealLeagueMedals(),
            this.repo.getAmongUsPrizes(),
        ]);

        const formatDisplayName = (
            firstname: string,
            infix: string | null,
            lastname: string,
            userId: number,
        ): string => {
            const parts = [firstname, infix, lastname]
                .map((v) => (v ?? "").trim())
                .filter((v) => v.length > 0);
            return parts.join(" ") || `User ${userId}`;
        };

        type RawPalmaresPrize = {
            seasonId: number;
            seasonLabel: string;
            userId: number;
            displayName: string;
            prizeLabel: string;
            source: "classification" | "winner" | "amongus";
            isVirtual: boolean;
            leagueId: number | null;
            leagueIcon: string | null;
            amongusLabel: string | null;
        };

        const rawPrizes: RawPalmaresPrize[] = [];

        // ---------------------------------------------------------
        // 1) Real league winners from "winner" (closed seasons only)
        // ---------------------------------------------------------
        for (const row of realLeagueRows) {
            rawPrizes.push({
                seasonId: row.season_id,
                seasonLabel: row.season_label,
                userId: row.user_id,
                displayName: formatDisplayName(
                    row.firstname,
                    row.infix,
                    row.lastname,
                    row.user_id,
                ),
                prizeLabel: row.league_label,
                source: "winner",
                isVirtual: false,
                leagueId: row.league_id,
                leagueIcon: row.league_icon,
                amongusLabel: null,
            });
        }

        // -----------------------------------------------------------------
        // 2) Virtual league winners (open season only) from classification:
        //    - season = current open season (if any)
        //    - league_id 1..10
        //    - use REAL standings (isVirtual=false) as "if season ended now"
        //    - league 1 winners cannot also win any other league (2..10)
        // -----------------------------------------------------------------
        if (currentSeasonId != null) {
            const { standings: league1Standings } = await classificationService.current(
                currentSeasonId,
                1,
                /* isVirtual */ false,
                "user,league,season",
            );

            const league1WinnerUserIds = new Set<number>();
            for (const r of (league1Standings as any[]) ?? []) {
                if (r.seed === 1 && r.user && typeof r.user.id === "number") {
                    league1WinnerUserIds.add(r.user.id);
                }
            }

            if (process.env.NODE_ENV !== "production") {
                console.log(
                    "[Palmares] League 1 current winners for virtual exclusion:",
                    Array.from(league1WinnerUserIds),
                );
            }

            for (let leagueId = 1; leagueId <= 10; leagueId++) {
                const { standings } = await classificationService.current(
                    currentSeasonId,
                    leagueId,
                    /* isVirtual */ false,
                    "user,league,season",
                );

                const rows = (standings as any[]) ?? [];
                if (!rows.length) continue;

                const winnerRows: any[] = [];

                if (leagueId === 1) {
                    // League 1: all seed=1 users are virtual winners (no exclusion).
                    for (const r of rows) {
                        if (r.seed === 1 && r.user && r.league && r.season) {
                            winnerRows.push(r);
                            if (process.env.NODE_ENV !== "production") {
                                console.log(
                                    `[Palmares] Virtual winner in league 1: user ${r.user.id} (${r.user.firstname} ${r.user.lastname}), seed=1.`,
                                );
                            }
                        }
                    }
                } else {
                    // Leagues 2..10: respect league 1 exclusion.
                    for (const r of rows) {
                        if (
                            r.seed === 1 &&
                            r.user &&
                            typeof r.user.id === "number" &&
                            league1WinnerUserIds.has(r.user.id)
                        ) {
                            if (process.env.NODE_ENV !== "production") {
                                console.log(
                                    `[Palmares] Excluding user ${r.user.id} (${r.user.firstname} ${r.user.lastname}) from virtual winner in league ${leagueId} (seed=1 in league 1).`,
                                );
                            }
                        }
                    }

                    const eligible = rows.filter(
                        (r) =>
                            r.user &&
                            typeof r.user.id === "number" &&
                            !league1WinnerUserIds.has(r.user.id),
                    );

                    if (!eligible.length) {
                        if (process.env.NODE_ENV !== "production") {
                            console.log(
                                `[Palmares] No eligible virtual winner in league ${leagueId} (all top users are league 1 winners).`,
                            );
                        }
                        continue;
                    }

                    let bestSeed = Number.POSITIVE_INFINITY;
                    for (const r of eligible) {
                        if (typeof r.seed === "number" && r.seed < bestSeed) {
                            bestSeed = r.seed;
                        }
                    }

                    for (const r of eligible) {
                        if (r.seed === bestSeed && r.user && r.league && r.season) {
                            winnerRows.push(r);
                            if (process.env.NODE_ENV !== "production") {
                                console.log(
                                    `[Palmares] Virtual winner in league ${leagueId}: user ${r.user.id} (${r.user.firstname} ${r.user.lastname}), seed=${r.seed}.`,
                                );
                            }
                        }
                    }
                }

                for (const r of winnerRows) {
                    const user = r.user;
                    const league = r.league;
                    const season = r.season;
                    if (!user || !league || !season) continue;

                    rawPrizes.push({
                        seasonId: season.id,
                        seasonLabel: season.label,
                        userId: user.id,
                        displayName: formatDisplayName(
                            user.firstname,
                            user.infix ?? null,
                            user.lastname,
                            user.id,
                        ),
                        prizeLabel: league.label,
                        source: "classification",
                        isVirtual: true,
                        leagueId: league.id,
                        leagueIcon: league.icon ?? null,
                        amongusLabel: null,
                    });
                }
            }
        }

        // ---------------------------------------------------------
        // 3) Onder Ons (amongus) winners — ALWAYS REAL here
        // ---------------------------------------------------------
        for (const row of amongUsRows) {
            rawPrizes.push({
                seasonId: row.season_id,
                seasonLabel: row.season_label,
                userId: row.user_id,
                displayName: formatDisplayName(
                    row.firstname,
                    row.infix,
                    row.lastname,
                    row.user_id,
                ),
                prizeLabel: row.amongus_label,
                source: "amongus",
                isVirtual: false,
                leagueId: null,
                leagueIcon: null,
                amongusLabel: row.amongus_label,
            });
        }

        // ---------------------------------------------------------
        // 4) Apply virtual toggle + build seasons + rows
        // ---------------------------------------------------------
        const prizes = is_virtual
            ? rawPrizes
            : rawPrizes.filter((p) => !p.isVirtual);

        // Seasons: all seasons present in the current prize set (newest first)
        const seasonMap = new Map<number, string>();
        for (const p of prizes) {
            if (!seasonMap.has(p.seasonId)) {
                seasonMap.set(p.seasonId, p.seasonLabel);
            }
        }

        const seasons = Array.from(seasonMap.entries())
            .sort((a, b) => b[0] - a[0]) // newest first
            .map(([seasonId, label]) => ({
                season_id: seasonId,
                season_label: label,
            }));

        // Order within a season:
        //   1) source: classification → winner → amongus
        //   2) league_id ascending (null last)
        //   3) prize_label
        //   4) display_name
        const sourceRank: Record<RawPalmaresPrize["source"], number> = {
            classification: 0,
            winner: 1,
            amongus: 2,
        };

        prizes.sort((a, b) => {
            if (a.seasonId !== b.seasonId) {
                return b.seasonId - a.seasonId; // season grouping (newest first)
            }
            const sr = sourceRank[a.source] - sourceRank[b.source];
            if (sr !== 0) return sr;

            const la = a.leagueId ?? Number.MAX_SAFE_INTEGER;
            const lb = b.leagueId ?? Number.MAX_SAFE_INTEGER;
            if (la !== lb) return la - lb;

            const pl = a.prizeLabel.localeCompare(b.prizeLabel);
            if (pl !== 0) return pl;

            return a.displayName.localeCompare(b.displayName);
        });

        const rows: PalmaresRowDto[] = prizes.map((p) => ({
            season_id: p.seasonId,
            season_label: p.seasonLabel,
            user_id: p.userId,
            display_name: p.displayName,
            prize_label: p.prizeLabel,
            source: p.source,
            is_virtual: p.isVirtual,
            league_id: p.leagueId,
            league_icon: p.leagueIcon,
            amongus_label: p.amongusLabel,
        }));

        const dto: PalmaresPageDto = {
            page_key: "palmares",
            page_title: "Palmares",
            page_subtitle: "Alle winnaars op een rij",
            supports_virtual: true,
            is_virtual,
            seasons,
            rows,
        };

        return dto;
    }
}

/*
CHANGES MADE (summary):

1) src/modules/statistics/statistics.types.ts
   - Extended StatsPerSeasonValueDto with:
     • season_open: boolean
     • is_virtual: boolean
   - Documented StatsSeasonDto.season_open as "1"/"0" flag for open season.

2) src/modules/statistics/statistics.service.ts
   - For all stats pages using StatsPageDto:
     • total_score, eagles, total_points, ups_missed, longest_time,
       most_efficient, on_throne
     → now call buildSeasonMeta(...) to:
       • set StatsSeasonDto.season_open = "1" only for the current open season.
       • set per-season cells’ season_open + is_virtual flags.
   - Updated all places where StatsPerSeasonValueDto objects are constructed
     (aggregateUserSeasonValues, submission coverage, most_efficient,
     on_throne) so they always include the new boolean fields, defaulting to
     false before buildSeasonMeta patches them.
   - Introduced private helper buildSeasonMeta(...) to avoid SQL in services
     and keep all “which season is open?” logic in one place, delegating the
     DB lookup to StatisticsRepo.getCurrentSeasonId().

Effect on FE:
- Payload shape is only extended, not broken.
- For each cell in per_season_values:
    • season_open tells you if this is the open season.
    • is_virtual mirrors the stats page’s virtual mode.
- This is enough to decide in Flutter:
    • if (effectiveIsVirtual && cell.season_open && cell.is_virtual)
         → render supertext with AppColors.virtual
      else
         → AppColors.primary.
*/