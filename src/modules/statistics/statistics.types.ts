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
    | "most_efficient";

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
}

export interface StatsLeftHeaderDto {
    position_label: string | null;
    name_label: string;
    total_label: string;
}

export interface StatsPerSeasonValueDto {
    value: string | null;
    supertext: string | null;
}

export interface StatsRowDto {
    key: string;
    position: number;
    display_name: string;
    total_value: string;
    total_supertext: string | null;
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
