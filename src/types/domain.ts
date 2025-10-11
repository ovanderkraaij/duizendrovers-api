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