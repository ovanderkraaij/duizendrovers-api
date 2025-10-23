//src/data/lookups.ts
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { qid, placeholders } from "../data/sql";
import type { Season, League, User, ExpandKey } from "../types/domain";

/** ---- registry types ---- */
type RegistryEntry<T> = {
    table: string;
    columns: readonly string[];
    projector: (row: any) => T;
};

type Registry = {
    season: RegistryEntry<Season>;
    league: RegistryEntry<League>;
    user: RegistryEntry<User>;
};

/** ---- concrete registry ---- */
const REGISTRY: Registry = {
    season: {
        table: "season",
        columns: ["label"],
        projector: (r: any): Season => ({
            id: Number(r.id),
            label: r.label ?? null,
        }),
    },
    league: {
        table: "league",
        columns: ["label"],
        projector: (r: any): League => ({
            id: Number(r.id),
            label: r.label ?? null,
        }),
    },
    user: {
        table: "users",
        columns: ["firstname", "infix", "lastname"],
        projector: (r: any): User => ({
            id: Number(r.id),
            firstname: r.firstname ?? null,
            infix: r.infix ?? null,
            lastname: r.lastname ?? null,
        }),
    },
};

/** ---- tiny in-memory cache with TTL ---- */
type Entry<T> = { at: number; data: Map<number, T> };
const TTL_MS = 60_000;
const cache: Record<string, Entry<any>> = {};

function getCached<T>(key: string): Map<number, T> | null {
    const e = cache[key];
    if (!e) return null;
    if (Date.now() - e.at > TTL_MS) return null;
    return e.data as Map<number, T>;
}
function setCached<T>(key: string, data: Map<number, T>) {
    cache[key] = { at: Date.now(), data };
}

/**
 * Generic fetcher for any ExpandKey ("season" | "league" | "user")
 * Returns a Map<id, DomainObject>.
 */
export async function getLookupMap(
    key: ExpandKey,
    ids: number[]
): Promise<Map<number, any>> {
    const unique = Array.from(new Set(ids)).filter((n) => Number.isFinite(n));
    if (unique.length === 0) return new Map();

    const reg = REGISTRY[key as keyof Registry] as RegistryEntry<any>;
    const cacheKey = `${key}:${unique.sort((a, b) => a - b).join(",")}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;

    const selectCols = ["id", ...reg.columns].map((c) => qid(c)).join(", ");
    const sql = `SELECT ${selectCols} FROM ${qid(reg.table)} WHERE ${qid("id")} IN (${placeholders(unique.length)})`;
    const [rows] = await pool.query<RowDataPacket[]>(sql, unique);

    const map = new Map<number, any>();
    for (const r of rows) {
        const obj = reg.projector(r);
        map.set(obj.id, obj);
    }

    setCached(cacheKey, map);
    return map;
}

/** Convenience wrappers with strong return types */
export async function mapSeasons(ids: number[]): Promise<Map<number, Season>> {
    return (await getLookupMap("season", ids)) as Map<number, Season>;
}
export async function mapLeagues(ids: number[]): Promise<Map<number, League>> {
    return (await getLookupMap("league", ids)) as Map<number, League>;
}
export async function mapUsers(ids: number[]): Promise<Map<number, User>> {
    return (await getLookupMap("user", ids)) as Map<number, User>;
}

/** Optional: display helper */
export function userDisplayName(u: User | null | undefined) {
    if (!u) return "";
    const parts = [u.firstname, u.infix, u.lastname].filter(Boolean);
    return parts.join(" ");
}