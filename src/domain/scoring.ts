// src/domain/scoring.ts
// Lightweight helpers shared by multiple modules.
// NOTE: This file intentionally does NOT perform any scoring math anymore.

/**
 * Canonical equality key for user/official comparison.
 * Precedence: listItemId > value > label.
 * We emit a single token to avoid accidental mismatch noise.
 */
export function canonicalKey(a: {
    label?: string | null;
    value?: string | number | null;
    listItemId?: number | null;
}): string {
    if (a.listItemId != null) return `li:${a.listItemId}`;
    if (a.value != null) return `v:${String(a.value)}`;
    return `l:${a.label ?? "null"}`;
}