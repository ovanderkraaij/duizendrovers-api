import {ExpandKey} from "../types/domain.js";

export function parseNumber(v: unknown): number | undefined {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
    return (typeof v === "string" && (allowed as readonly string[]).includes(v)) ? v as T : d;
}

export function parseExpand(expand?: string | string[]) {
    const s = new Set<ExpandKey>();
    if (!expand) return s;
    const raw = Array.isArray(expand) ? expand.join(",") : expand;
    for (const part of raw.split(",").map(x => x.trim().toLowerCase())) {
        if (part === "all") ["season","league","user"].forEach(k => s.add(k as ExpandKey));
        if (part === "season" || part === "league" || part === "user") s.add(part);
    }
    return s;
}