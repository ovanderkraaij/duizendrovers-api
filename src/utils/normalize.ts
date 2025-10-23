// -----------------------------------------
// file: src/utils/normalize.ts
// -----------------------------------------
import { NormalizedResult } from '../types/domain';

/** Pad integer to 2 digits. */
const z2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** Convert seconds → HH:MM:SS (hours can exceed 23). */
export function toHHMMSS(totalSeconds: number): string {
    const s = Math.max(0, Math.trunc(totalSeconds));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${z2(hh)}:${z2(mm)}:${z2(ss)}`;
}

/**
 * Normalize a time label "H+:MM:SS" (1–3 digit hours allowed) into seconds.
 * Examples: "2:03:12", "02:03:12", "125:59:59"
 */
export function normalizeTime(label: string): NormalizedResult {
    const trimmed = label.trim();
    const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(trimmed);
    if (!m) {
        // If frontend validation failed to catch it, keep label but store 0 seconds.
        return { result: "0", label: "00:00:00" };
    }
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    const total = hh * 3600 + mm * 60 + ss;
    return { result: String(total), label: toHHMMSS(total) };
}
/**
 * Normalize decimal label to canonical string with dot as separator.
 * Accepts comma or dot in input.
 */
/**
 * Parse a human decimal that may use ',' or '.' as decimal separator
 * and either ',' '.' or spaces as thousands separators.
 * Returns a JS number (or NaN if truly invalid).
 */
function parseLooseDecimal(input: string): number {
    let s = (input ?? "").trim();

    // quick exits
    if (!s) return NaN;

    // Remove spaces
    s = s.replace(/\s+/g, "");

    // If both ',' and '.' appear, assume the RIGHTMOST one is the decimal separator.
    const lastComma = s.lastIndexOf(",");
    const lastDot   = s.lastIndexOf(".");
    if (lastComma !== -1 && lastDot !== -1) {
        const decIsComma = lastComma > lastDot;
        if (decIsComma) {
            // ',' is decimal, '.' are thousands
            s = s.replace(/\./g, "");   // drop thousands dots
            s = s.replace(",", ".");    // decimal comma -> dot
        } else {
            // '.' is decimal, ',' are thousands
            s = s.replace(/,/g, "");    // drop thousands commas
            // '.' stays as decimal
        }
    } else if (lastComma !== -1) {
        // Only comma present -> treat as decimal comma
        s = s.replace(",", ".");
    } else {
        // Only dot or neither: if only dot, it's already decimal; else, integer
        // leave as-is
    }

    // Strip any lingering non-numeric (except leading +/-, one dot)
    // (This is defensive; normal inputs shouldn't need it.)
    s = s.replace(/[^0-9.+-]/g, "");

    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Normalize decimal label to canonical dot-decimal string in result.
 * Accepts comma or dot input, with optional thousands separators.
 * - result: "394.5" (dot decimal, no thousands)
 * - label:  unchanged trimmed input (UI can still show the user's original)
 */
export function normalizeDecimal(label: string): NormalizedResult {
    const trimmed = (label ?? "").trim();
    const n = parseLooseDecimal(trimmed);
    if (!Number.isFinite(n)) {
        // If you prefer a soft fallback instead of throwing later, you can
        // return "0" here — but keeping it strict avoids silent bad data.
        return { result: "NaN", label: trimmed };
    }
    // Keep a minimal dot-decimal string (no unnecessary trailing zeros)
    // Using String(n) preserves "270" instead of "270.0"
    return { result: String(n), label: trimmed };
}
/**
 * Normalize meters,centimeters (e.g., "7,23") to total centimeters string.
 */
export function normalizeMCM(label: string): NormalizedResult {
    let raw = (label ?? "").trim();
    if (!raw) return { result: "0", label: "0,00" };

    // Accept both "," and "." as separators; split on whichever appears first
    const normalized = raw.replace(/\s+/g, "").replace(".", ",");
    const parts = normalized.split(",");

    const mStr = parts[0] || "0";
    const cStr = parts[1] || "0";

    const m = parseInt(mStr, 10) || 0;
    const c = parseInt(cStr, 10) || 0;

    const total = m * 100 + c;
    const disp = `${m},${z2(c)}`;
    return { result: String(total), label: disp };
}

/**
 * No normalization for LIST: we simply carry the label and listItemId,
 * and store an optional label for display. Caller must provide both.
 */
export function passthroughList(listItemId: number, label: string): NormalizedResult {
    return { result: label, label, listItemId };
}

/**
 * Football/Hockey normalization.
 * - baseScore: "H-A" at 90' (football) or 60' (hockey)
 * - drawTag: optional when H==A: 'twnv' | 'uwnv' | 'twns' | 'uwns'
 *   (t=home, u=away, wnv = wint na verlenging, wns = wint na strafschoppen/shootouts)
 *
 * Output result follows legacy pattern used in PHP:
 *   if draw + tag: `${H}-${A} <Team> ${suffix}` where suffix is 'wnv' or 'wns'.
 *   Otherwise: `${H}-${A}`
 *
 * We do not expand <Team> here (team names are embedded in label upstream);
 * we persist the compact canonical `${baseScore}${optional(' ' + drawTag)}` form for DB `result`.
 */
export function normalizeScoreWithDraw(baseScore: string, drawTag?: 'twnv'|'uwnv'|'twns'|'uwns'): NormalizedResult {
    const clean = baseScore.trim();
    const [hStr, aStr] = clean.split('-').map(s => s.trim());
    const label = clean; // UI label keeps the score entered
    if (hStr === aStr) {
        if (!drawTag) {
            // caller should enforce drawTag presence via validation when draw
            return { result: label, label };
        }
        // We store a compact canonical: "H-A <drawTag>"
        return { result: `${hStr}-${aStr} ${drawTag}`, label };
    }
    return { result: label, label };
}

/**
 * Reverse conversions for display (used when rendering stored results):
 */
export function displayFromTimeSeconds(seconds: number): string {
    return toHHMMSS(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
}

export function displayFromMCM(totalCm: number): string {
    const m = Math.floor(totalCm / 100);
    const c = totalCm % 100;
    return `${m},${z2(c)}`;
}

export function buildVariantsGeneric(center: number, margin: number, step: number, decimals: number): number[] {
    const f = Math.pow(10, Math.max(0, decimals));
    const C = Math.round(center * f);
    const S = Math.max(1, Math.round(Math.abs(step) * f));
    const M = Math.max(0, Math.round(Math.abs(margin) * f));

    const ints: number[] = [];
    ints.push(C);
    for (let off = S; off <= M; off += S) {
        ints.push(C - off, C + off);
    }
    ints.sort((a, b) => a - b);

    // dedupe
    const uniq: number[] = [];
    for (const v of ints) {
        if (uniq.length === 0 || uniq[uniq.length - 1] !== v) uniq.push(v);
    }
    return uniq.map(v => v / f);
}
/** How many decimals to consider based on 'step' (e.g., 0.5 → 1, 0.25 → 2). */
export function decimalsFromStep(step: number): number {
    const s = String(step);
    if (!s.includes('.')) return 0;
    return s.split('.')[1].length;
}

/** Dot-decimal without trailing zeros (legacy compact result storage). */
export function formatResultDot(value: number, decimals: number): string {
    const f = Math.pow(10, Math.max(0, decimals));
    const n = Math.round(value * f) / f;
    // turn into minimal string (no trailing zeros)
    const as = String(n);
    // JS already trims trailing zeros in most cases; ensure "270" not "270.0"
    return as;
}

/** Comma-decimal label with fixed decimals matching step precision. */
export function formatLabelComma(value: number, decimals: number): string {
    if (decimals <= 0) return String(Math.round(value)).replace('.', ',');
    // fixed to the step's precision for consistent variant labels
    return value.toFixed(decimals).replace('.', ',');
}

// Returns absolute values: [center, center±step, center±2*step, ...] up to margin.
// decimals = number of fraction digits to round to (based on step, e.g. 0.5 -> 1).
export function buildVariantsAround(
    center: number,
    margin: number,
    step: number,
    decimals: number
): number[] {
    const s = Math.abs(step);
    const m = Math.abs(margin);
    if (s <= 0 || m < 0) return [center];

    const steps = Math.round(m / s); // inclusive steps on each side
    const scale = Math.pow(10, Math.max(0, decimals));
    const roundAt = (x: number) => Math.round(x * scale) / scale;

    const out: number[] = [];
    out.push(roundAt(center));
    for (let k = 1; k <= steps; k++) {
        const off = k * s;
        out.push(roundAt(center - off));
        out.push(roundAt(center + off));
    }

    // de-dupe + sort (precaution)
    const uniq = Array.from(new Set(out.map(v => roundAt(v))));
    uniq.sort((a, b) => a - b);
    return uniq;
}

// utils/normalize.ts
export function buildVariantsBySteps(
    center: number,
    stepCount: number,   // number of steps from the base on each side
    stepSize: number,    // the step value (same unit as center)
    decimals: number
): number[] {
    const sCount = Math.max(0, Math.round(Math.abs(stepCount)));
    const s = Math.abs(stepSize);
    const scale = Math.pow(10, Math.max(0, decimals));
    const roundAt = (x: number) => Math.round(x * scale) / scale;

    const out: number[] = [roundAt(center)];
    for (let k = 1; k <= sCount; k++) {
        const off = k * s;
        out.push(roundAt(center - off));
        out.push(roundAt(center + off));
    }
    // sort & de-dupe for safety
    const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
    return uniq;
}