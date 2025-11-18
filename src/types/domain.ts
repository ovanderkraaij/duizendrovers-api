// src/types/domain.ts
// === Core domain models (1:1 with DB tables) ===
export interface Classification {
    season_id: number;
    league_id: number;
    user_id: number;
    question_id: number;
    points: number | null;
    score: number | null;
    sequence: number;
    seed: number;
    virtual: string | null;    // '1' = virtual, '', '0' or NULL = real
    insertion?: string;
    changed?: number;
    score_ball?: number;
    prev_seed?: number | null;
    movement?: number | null;
}

export interface Season {
    id: number;
    label: string | null;
}

export interface League {
    id: number;
    label: string | null;
}

export interface User {
    id: number;
    firstname: string | null;
    infix: string | null;
    lastname: string | null;
}

// === Enriched types (when expand=season,league,user) ===
export interface ClassificationExpanded extends Classification {
    season?: Season | null;
    league?: League | null;
    user?: User | null;
}

// === Pagination & metadata ===
export interface PageMeta {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    orderBy: string;
    orderDir: "asc" | "desc";
}
export interface PageResult<T> {
    data: T[];
    meta: PageMeta;
}

export type ExpandKey = "season" | "league" | "user";

// === Helpers ===
// Accept "0|1" or "real|virtual" in path; returns true when virtual.
export function parseVirtualParam(p: string): boolean {
    const v = (p ?? "").toString().trim().toLowerCase();
    if (v === "1" || v === "virtual") return true;
    return false;
}

export type ID = number;

export type ResultTypeLabel =
    | 'list'
    | 'open'
    | 'time'
    | 'decimal'
    | 'mcm'
    | 'football'
    | 'hockey';

export interface Bet {
    id: ID;
    label: string;
    seasonId: ID;
    deadline?: string; // ISO
    active: boolean;
    closed: boolean;
}

export interface Question {
    id: ID;
    betId: ID;
    questionId?: ID | null; // null for main
    resultTypeId: ID;
    resultTypeLabel: ResultTypeLabel;
    groupCode: number;
    margin?: number | null; // null => no margin
    step?: number | null;   // for margin
    lineup: number;
    points: number;         // main points or bonus points (0 for sub)
    average: number;        // divisor in preclassification
    block: boolean;         // podium groups
    title?: string | null;
    label: string;
    descr?: string | null;
    sportId?: ID | null;
}

export interface Answer {
    id?: ID;
    questionId: ID;
    userId: ID;
    /** Raw result value as stored in DB (already normalized for open/time/mcm/decimal/football/hockey). */
    result: string;
    label: string; // human label
    points: number;
    score: number;
    correct: '0' | '1';
    posted: '0' | '1';
    eliminated: '0' | '1';
    gray: '0' | '1';
    listItemId?: ID | null; // when resulttype = list
}

export interface ListItemRef { id: ID; label: string; }

export interface SubmitPayload {
    betId: ID;
    userId: ID;
    answers: Array<
        | { type: 'list'; questionId: ID; listItemId: ID }
        | { type: 'time'; questionId: ID; label: string }          // HH:MM:SS
        | { type: 'decimal'; questionId: ID; label: string }       // locale-aware, may contain comma
        | { type: 'mcm'; questionId: ID; label: string }           // M,CC (e.g., '7,23')
        | { type: 'open'; questionId: ID; label: string }          // free text
        | { type: 'football' | 'hockey'; questionId: ID; baseScore: string; drawTag?: 'twnv'|'uwnv'|'twns'|'uwns' }
        >;
}

export interface NormalizedResult {
    result: string; // DB result value
    label: string;  // display label
    listItemId?: ID | null;
}

export interface Squad {
    id: number;
    label: string;
    scode?: string | null;
    color?: string | null;
    bgcolor?: string | null;
}

export interface SquadMember {
    user_id: number;
    is_captain: boolean; // '1' -> true, else false
}

export interface SquadStanding {
    squadId: number;
    label: string;

    // Totals computed at `sequence`
    score: number;

    // Totals computed at `previousSequence` (or falling back if none)
    previousScore: number;

    // Seed ordering (1-based, ties share same seed)
    seed: number;
    previousSeed: number;

    // Up/down/equal based on previousSeed vs seed
    evolution: "up" | "down" | "equal";

    // Optional: per-user total (already captain-adjusted & normalized per question)
    perUserTotals?: Record<number, number>;

    // Optional: raw members list (handy for FE)
    members?: SquadMember[];
}

export interface SquadStandingsResponse {
    seasonId: number;
    leagueId: number;           // always 1 for now
    virtual: boolean;
    sequence: number;           // latest seq for the chosen dataset (virtual/real)
    previousSequence: number | null;
    smallestSquadSize: number;
    standings: SquadStanding[];
}