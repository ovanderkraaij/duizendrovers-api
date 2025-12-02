// src/modules/utils/date.ts
/**
 * Date/time helpers for the backend.
 *
 * Note:
 * - Server timezone is CE(S)T and DB stores Amsterdam time.
 * - For JSON logging and external APIs we use ISO-8601 UTC (Z).
 */

/** Convert local/offsetted date to ISO-8601 UTC (Z) */
export function toUtcZ(input: string | Date | null | undefined): string | null {
    if (!input) return null;
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

/** Convenience: now as ISO-8601 UTC string. */
export function nowUtcZ(): string {
    return new Date().toISOString();
}