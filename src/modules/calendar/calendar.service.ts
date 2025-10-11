// src/modules/calendar/calendar.service.ts
import { fetchOpenSeasonEvents, DbEvent } from "./calendar.repo";
import { fetchSportevenementen, WpEvent } from "./wp.client";

export type CalendarItem = {
    id: number;
    label: string;
    active: boolean;
    virtual: boolean;
    sportId: number | null;
    deadline: string | null; // DB deadline (ISO or YYYY-MM-DD)

    wpId: number | null;
    title: string;
    imageUrl: string | null;
    commentCount: number;
    hasVideo: boolean;

    // Raw WP string (e.g., "14-07-2019") kept for display/audit
    temporaryDeadline: string | null;

    // NEW: canonical UTC ISO derived from temporaryDeadline (end-of-day Europe/Amsterdam)
    temporaryDeadlineUtc: string | null;

    slug: string | null;
};

// Converts dd-MM-yyyy -> yyyy-MM-dd; otherwise returns input unchanged.
function normalizeDutchDateToIso(raw: string): string {
    const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return raw;
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
}

// Return end-of-day UTC for a variety of inputs. If parsing fails, null.
function asEndOfDayUtc(input: unknown): Date | null {
    if (input == null) return null;

    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }

    const raw = String(input).trim();
    if (!raw) return null;

    // Accept WP "dd-MM-yyyy" and normalize to "yyyy-MM-dd"
    const maybeIsoDate = normalizeDutchDateToIso(raw);

    // If it's date-only (YYYY-MM-DD), append end-of-day
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(maybeIsoDate);
    const withTime = isDateOnly ? `${maybeIsoDate} 23:59:59` : maybeIsoDate;

    // Normalize to ISO-ish and force UTC for stable ordering
    const iso = withTime.includes("T") ? withTime : withTime.replace(" ", "T");
    const withZ = /Z$/.test(iso) ? iso : `${iso}Z`;

    const d = new Date(withZ);
    return isNaN(d.getTime()) ? null : d;
}

export async function getCalendar(): Promise<CalendarItem[]> {
    const [events, wp] = await Promise.all([
        fetchOpenSeasonEvents(),
        fetchSportevenementen(1, 100),
    ]);

    const wpByEvent = new Map<number, WpEvent>();
    for (const w of wp) {
        if (w.eventId != null) wpByEvent.set(w.eventId, w);
    }

    const merged: CalendarItem[] = events.map((ev: DbEvent) => {
        const w = wpByEvent.get(ev.id) || null;

        // Raw WP text (often "dd-MM-yyyy"), keep as-is for display/audit
        const tmpText = w?.temporaryDeadline ?? null;

        // Canonical UTC (end-of-day) derived from tmpText, if present
        const tmpUtcDate = asEndOfDayUtc(tmpText);
        const tmpUtcIso = tmpUtcDate ? tmpUtcDate.toISOString() : null;

        return {
            id: ev.id,
            label: ev.label,
            active: ev.active === 1,
            virtual: ev.virtual === 1,
            sportId: ev.sport_id ?? null,

            // DB deadline should already be ISO or YYYY-MM-DD (we still normalize later when sorting)
            deadline: ev.deadline ?? null,

            wpId: w?.wpId ?? null,
            title: w?.title ?? ev.label,
            imageUrl: w?.imageUrl ?? null,
            commentCount: w?.commentCount ?? 0,
            hasVideo: w?.hasVideo ?? false,

            temporaryDeadline: tmpText,
            temporaryDeadlineUtc: tmpUtcIso,

            slug: w?.slug ?? null,
        };
    });

    // Sorting rule (stable):
    // 1) Items with a DB deadline (normalized to end-of-day) come first, ascending.
    // 2) Otherwise, items with a WP temporary deadline (canonical UTC) ascending.
    // 3) Otherwise, undated items.
    // Ties break by id ascending.
    merged.sort((a, b) => {
        const da =
            (a.deadline && asEndOfDayUtc(a.deadline)) ||
            (a.temporaryDeadlineUtc ? new Date(a.temporaryDeadlineUtc) : null);
        const db =
            (b.deadline && asEndOfDayUtc(b.deadline)) ||
            (b.temporaryDeadlineUtc ? new Date(b.temporaryDeadlineUtc) : null);

        if (da && db) {
            const diff = da.getTime() - db.getTime();
            if (diff !== 0) return diff;
            return a.id - b.id;
        }
        if (da && !db) return -1;
        if (!da && db) return 1;
        return a.id - b.id;
    });

    return merged;
}