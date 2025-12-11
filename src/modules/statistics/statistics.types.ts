// src/modules/statistics/statistics.types.ts

import type { RowDataPacket } from "mysql2/promise";

/**
 * Statistics page keys — extend this as we add more pages.
 *
 * NOTE: This union must stay in sync with:
 * - the switch in StatisticsService.getStatisticsPage
 * - the allowedPages array in src/routes/statistics.ts
 */
export type StatisticsPageKey =
    | "total_score"
    | "eagles"
    | "total_points"
    | "ups_missed"
    | "longest_time"
    | "most_efficient"
    | "on_throne";

/**
 * Request body coming from the Flutter app.
 */
export interface StatisticsPageRequestDto {
    stats_page: StatisticsPageKey;
    user_id: number | null;
    is_virtual: boolean;
}

/**
 * Public response payload — this matches exactly what the FE expects.
 */
export interface StatsSeasonDto {
    season_id: number;
    season_label: string;
    /**
     * "1" if this season is currently open in the DB (closed = '0'), otherwise "0".
     * This keeps the FE dumb: it only needs to compare string values.
     */
    season_open: string;
}

export interface StatsLeftHeaderDto {
    position_label: string | null;
    name_label: string;
    total_label: string;
}

/**
 * Per-season value in the right-hand column of the stats table.
 *
 * - value       → formatted display value for that season
 * - raw_value   → numeric value used for ordering/logic
 * - supertext   → per-season position or extra info (can be null)
 * - season_open → true if this cell belongs to the currently open season
 * - is_virtual  → true if this cell comes from a virtual stats variant
 */
export interface StatsPerSeasonValueDto {
    value: string | null;
    raw_value: number | null;
    supertext: string | null;
    season_open: boolean;
    is_virtual: boolean;
}

export interface StatsRowDto {
    key: string;
    position: number;
    display_name: string;
    total_value: string;
    total_raw_value: number | null;
    movement_from_real: string | null;
    per_season_values: Record<number, StatsPerSeasonValueDto>;
}

export interface StatsPageDto {
    page_title: string;
    page_subtitle: string | null;

    supports_virtual: boolean;
    is_virtual: boolean;

    personal_user_id: number | null;
    personal_user_position: number | null;
    personal_user_name: string | null;
    personal_row_key: string | null;

    has_super: boolean;
    total_column_width_factor: number;
    number_decimals: number;

    left_header: StatsLeftHeaderDto;
    seasons: StatsSeasonDto[];
    rows: StatsRowDto[];
}

/**
 * Internal repo result types
 */

export interface TotalScoreSeasonRow extends RowDataPacket {
    season_id: number;
    season_label: string;
    /**
     * Season weight as a percentage (e.g. 100 = 100%).
     * For now we return 100 for all seasons; business rules can later alter this.
     */
    weight_percent: number;
}

export interface TotalScoreUserSeasonRow extends RowDataPacket {
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    season_id: number;
    score: number;
    final_position: number | null;
}

/**
 * For the "most_efficient" page we need both points and score
 * per (user, season). These come from the classification table.
 */
export interface EfficiencyUserSeasonRow extends RowDataPacket {
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    season_id: number;
    points: number;
    score: number;
}

/**
 * For the "on_throne" page we need per-user, per-season day counts
 * spent on position 1 in league 1 (virtual = 0).
 */
export interface OnThroneUserSeasonRow extends RowDataPacket {
    user_id: number;
    season_id: number;
    days_on_throne: number;
}

/**
 * Bullseye statistics — request + payload.
 * NOTE:
 * - This page has its own payload; it does NOT use StatsPageDto.
 * - It shares only the fact that it lives under /statistics.
 */
export interface BullseyeRequestDto {
    user_id: number | null;
}

export interface BullseyeSolutionDto {
    solution_flag: string | null;
    solution_team: string | null;
    solution_label: string | null;
    solution_fg: string | null;
    solution_bg: string | null;
    show_teams: boolean | null;
}

export interface BullseyeQuestionDto {
    question_id: number;
    question_name: string;
    is_main: boolean;
    is_bonus: boolean;
    is_first_bonus: boolean;
    solution: BullseyeSolutionDto;
}

export interface BullseyeBundleDto {
    event_id: number;
    event_name: string;
    questions: BullseyeQuestionDto[];
}

export interface BullseyeUserHitDto {
    user_id: number;
    display_name: string;
    number_of_20: number;
    number_of_20_virtual: number;
    main_is_virtual: number;
    bundle: BullseyeBundleDto;
}

export interface BullseyeSeasonDto {
    season_id: number;
    season_label: string;
    bullseyes: BullseyeUserHitDto[];
}

export interface BullseyePersonalBarDto {
    user_id: number | null;
    display_name: string | null;
    number_of_20: number;
    number_of_20_virtual: number;
}

export interface BullseyeStatsDto {
    user_id: number | null;
    is_virtual: boolean;
    seasons: BullseyeSeasonDto[];
    personal_bar: BullseyePersonalBarDto;
}

/**
 * Low-level DB row used by StatisticsRepo.getBullseyeRows.
 * One row = one question inside a bullseye bundle for one user.
 */
export interface BullseyeRow extends RowDataPacket {
    season_id: number;
    season_label: string;
    bet_id: number;
    bet_label: string;
    groupcode: number;
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    question_id: number;
    question_label: string;
    is_main: number; // 0/1
    is_bonus: number; // 0/1
    is_first_bonus: number; // 0/1
    answer_label: string | null;
    answer_listitem_id: number | null;
    bundle_score: number;
    main_virtual: number; // 0/1
}

/**
 * Medal kinds for the medal table.
 */
export type MedalKind = "gold" | "silver" | "bronze" | "ivory";

/**
 * Totals per user for the medal table, including flags indicating
 * whether a given bucket contains at least one virtual medal.
 *
 * These *_has_virtual flags allow the FE to color the numbers without
 * having to re-analyse all per-season prizes.
 */
export interface MedalsTotalsDto {
    total: number;
    total_has_virtual: boolean;

    gold: number;
    gold_has_virtual: boolean;

    silver: number;
    silver_has_virtual: boolean;

    bronze: number;
    bronze_has_virtual: boolean;

    ivory: number;
    ivory_has_virtual: boolean;
}

/**
 * Request payload for the medal table.
 * Mirrors the other stats endpoints: user_id is currently unused by BE,
 * but kept for consistency and future "personal" views.
 */
export interface MedalsRequestDto {
    user_id: number | null;
    is_virtual: boolean;
}

/**
 * One prize/medal in a given season for a given user.
 *
 * - kind          → drives color in the FE ("gold" | "silver" | "bronze" | "ivory").
 * - prize_label   → human readable name ("Champions League", "Triatlon", …).
 * - is_virtual    → true for virtual medals (open season classification, open Onder Ons).
 * - league_id     → 1..10 for league medals, otherwise null for Onder Ons.
 * - league_icon   → raw filename from league.icon, e.g. "league_hat.png" (can be null).
 * - amongus_label → label from amongus.label for ivory medals (used for AppConfig.amongIconUrl).
 */
export interface MedalsPrizeDto {
    kind: MedalKind;
    prize_label: string;
    is_virtual: boolean;
    league_id: number | null;
    league_icon: string | null;
    amongus_label: string | null;
}

/**
 * Per-season grouping of medals in the expanded panel.
 */
export interface MedalsSeasonDto {
    season_id: number;
    season_label: string;
    /**
     * true if this season is currently open in the DB (closed = '0'), otherwise false.
     * FE uses this purely for styling; semantics are identical to other stats pages.
     */
    season_open: boolean;
    prizes: MedalsPrizeDto[];
}

/**
 * One row in the main medal table (per user).
 *
 * - position              → current position in the *active* mode (real or virtual).
 * - movement_from_real    → in virtual mode, how many places the user moved compared
 *                           to the real-only ranking (real_position - virtual_position).
 *                           Positive = moved up, negative = moved down. Null in real mode.
 */
export interface MedalsRowDto {
    user_id: number;
    display_name: string;
    position: number;
    totals: MedalsTotalsDto;
    seasons: MedalsSeasonDto[];
    movement_from_real: number | null;
}

/**
 * Medal table page payload — lives under /api/v1/statistics/medals.
 * This does NOT change any existing StatsPageDto payloads.
 */
export interface MedalsPageDto {
    page_title: string;
    page_subtitle: string;

    supports_virtual: boolean;
    is_virtual: boolean;

    rows: MedalsRowDto[];
}

/**
 * Internal repo result types for medal table.
 * These are low-level DB projections used only by StatisticsRepo.
 */
export interface RealLeagueWinnerRow extends RowDataPacket {
    season_id: number;
    season_label: string;
    season_closed: string;
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    league_id: number;
    league_label: string;
    league_icon: string;
}

export interface VirtualLeagueLeaderRow extends RowDataPacket {
    season_id: number;
    season_label: string;
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    league_id: number;
    league_label: string;
    league_icon: string;
}

export interface AmongUsRow extends RowDataPacket {
    season_id: number;
    season_label: string;
    season_closed: string;
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    amongus_label: string;
}

// src/modules/statistics/statistics.types.ts

// …keep existing imports and types above…

/**
 * Request payload for the medal table.
 * Mirrors the other stats endpoints: user_id is currently unused by BE,
 * but kept for consistency and future "personal" views.
 */
export interface MedalsRequestDto {
    user_id: number | null;
    is_virtual: boolean;
}

// …existing Medals* types stay as-is…

export interface AmongUsRow extends RowDataPacket {
    season_id: number;
    season_label: string;
    season_closed: string;
    user_id: number;
    firstname: string;
    infix: string | null;
    lastname: string;
    amongus_label: string;
}

/**
 * Source of a Palmares prize.
 * - "classification" → virtual league winner (open season, derived from classification)
 * - "winner"        → real league winner from winner table
 * - "amongus"       → Onder Ons winner from amongus table
 */
export type PalmaresSource = "classification" | "winner" | "amongus";

/**
 * Request payload for the Palmares page.
 * Kept consistent with other stats endpoints.
 */
export interface PalmaresRequestDto {
    user_id: number | null;
    is_virtual: boolean;
}

/**
 * Season chip for the Palmares page.
 * Note: no season_open flag here; FE only needs label + id for filtering.
 */
export interface PalmaresSeasonDto {
    season_id: number;
    season_label: string;
}

/**
 * One row in the Palmares table.
 *
 * - season_id / season_label → used for grouping + the "Seizoen" column
 * - user_id / display_name   → winner
 * - prize_label              → human-readable prize name
 * - source                   → which table/derivation this prize came from
 * - is_virtual               → true only for classification-based winners in the CURRENT open season
 * - league_id / league_icon  → for league-based prizes (can be null for Onder Ons)
 * - amongus_label            → for Onder Ons icon lookup (can be null)
 */
export interface PalmaresRowDto {
    season_id: number;
    season_label: string;

    user_id: number;
    display_name: string;

    prize_label: string;
    source: PalmaresSource;

    is_virtual: boolean;
    league_id: number | null;
    league_icon: string | null;
    amongus_label: string | null;
}

/**
 * Palmares page payload — lives under /api/v1/statistics/palmares.
 * This does NOT change any existing StatsPageDto payloads.
 */
export interface PalmaresPageDto {
    page_key: "palmares";
    page_title: string;
    page_subtitle: string;

    supports_virtual: boolean;
    is_virtual: boolean;

    seasons: PalmaresSeasonDto[];
    rows: PalmaresRowDto[];
}