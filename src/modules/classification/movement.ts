// src/modules/classification/data/movement.ts
import type { Classification } from "../../types/domain";

/**
 * Recompute movement for a "current" table against a "baseline" table.
 * We match rows by (season_id, league_id, user_id).
 * - prev_seed: seed from baseline (or null if not found)
 * - movement:  prev_seed - current.seed (signed), or null if prev_seed missing
 */
export function applyMovementAgainstBaseline<T extends Classification>(
    current: T[],
    baseline: Classification[]
): T[] {
    // Build quick lookup: key = season|league|user -> baseline seed
    const key = (r: Classification) => `${r.season_id}|${r.league_id}|${r.user_id}`;
    const baseMap = new Map<string, number>();
    for (const r of baseline) {
        baseMap.set(key(r), Number(r.seed));
    }

    // Return new array with prev_seed/movement overridden based on baseline
    return current.map((row) => {
        const k = key(row);
        const prevSeed = baseMap.has(k) ? Number(baseMap.get(k)) : null;

        // If we have a baseline seed, movement = prev_seed - current.seed
        const movement =
            prevSeed == null
                ? null
                : (Number(prevSeed) - Number(row.seed));

        // Preserve everything else, overwrite only prev_seed/movement
        return {
            ...row,
            // @ts-expect-error: prev_seed/movement exist on Classification shape in your repo
            prev_seed: prevSeed,
            movement: movement as any,
        };
    });
}