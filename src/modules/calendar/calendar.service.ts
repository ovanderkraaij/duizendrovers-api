// src/modules/calendar/calendar.service.ts
import { fetchOpenSeasonEvents, fetchEventsBySeason, DbEvent } from "./calendar.repo";
import { fetchSportevenementen, WpEvent } from "./wp.client";
import { QuestionsRepo } from "../questions/questions.repo";
import { QuestionService } from "../questions/questions.service";
import { pool } from "../../db";

export type CalendarItem = {
    id: number;
    label: string;
    active: boolean;
    virtual: boolean; // deprecated at bet-level but kept for FE compatibility
    sportId: number | null;

    // UTC timestamps (nullable)
    deadlineUtc: string | null;
    expectedUtc: string | null;
    effectiveDeadlineUtc: string | null; // = deadlineUtc ?? expectedUtc

    // WP coupling
    wpId: number | null;
    wp_post_id?: number | null; // kept for FE convenience

    title: string;
    imageUrl: string | null;
    commentCount: number;
    hasVideo: boolean;
    slug: string | null;

    // question index helpers
    mainCount: number;
    mainIndexStart: number;
    mainIndexEnd: number;

    // Results/virtual flags
    hasSolution: boolean;
    virtualAnyMain: boolean; // ← NEW
};

function toBool(v: unknown): boolean {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.trim() === "1" || v.trim().toLowerCase() === "true";
    if (Buffer.isBuffer(v)) return v.length > 0 && v[0] === 1;
    return false;
}

/** Convert local/offseted date to ISO-8601 UTC (Z) */
function toUtcZ(input: string | Date | null | undefined): string | null {
    if (!input) return null;
    const d = new Date(input);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
}

function mergeEventsWithWp(events: DbEvent[], wp: WpEvent[]): CalendarItem[] {
    const wpByEvent = new Map<number, WpEvent>();
    for (const w of wp) if (w.eventId != null) wpByEvent.set(w.eventId, w);

    return events.map((ev) => {
        const w = wpByEvent.get(ev.id) || null;

        const deadlineUtc = toUtcZ(ev.deadline);
        const expectedUtc = toUtcZ(ev.expected);
        const effectiveDeadlineUtc = deadlineUtc ?? expectedUtc ?? null;

        return {
            id: ev.id,
            label: ev.label,
            active: toBool(ev.active),
            virtual: toBool(ev.virtual), // deprecated at bet-level
            sportId: ev.sport_id ?? null,

            deadlineUtc,
            expectedUtc,
            effectiveDeadlineUtc,

            wpId: w?.wpId ?? null,
            wp_post_id: w?.wpId ?? null,

            title: w?.title ?? ev.label,
            imageUrl: w?.imageUrl ?? null,
            commentCount: w?.commentCount ?? 0,
            hasVideo: w?.hasVideo ?? false,
            slug: w?.slug ?? null,

            mainCount: 0,
            mainIndexStart: 0,
            mainIndexEnd: 0,

            hasSolution: toBool((ev as any).has_solution),
            virtualAnyMain: toBool((ev as any).virtual_any_main), // ← NEW
        };
    });
}

async function attachMainQuestionCounts(items: CalendarItem[]): Promise<CalendarItem[]> {
    const questionsRepo = new QuestionsRepo(pool);
    const questionsSvc = new QuestionService(questionsRepo);
    let runningIndex = 1;

    for (const item of items) {
        try {
            const mains = await questionsSvc.getMainQuestions(item.id);
            const count = mains.length;
            item.mainCount = count;
            item.mainIndexStart = runningIndex;
            item.mainIndexEnd = runningIndex + count - 1;
            runningIndex += count;
        } catch {
            item.mainCount = 0;
            item.mainIndexStart = runningIndex;
            item.mainIndexEnd = runningIndex;
        }
    }
    return items;
}

/** Open season */
export async function getCalendar(): Promise<CalendarItem[]> {
    const [events, wp]: [DbEvent[], WpEvent[]] = await Promise.all([
        fetchOpenSeasonEvents(),
        fetchSportevenementen(1, 100),
    ]);

    const merged = mergeEventsWithWp(events, wp);
    return await attachMainQuestionCounts(merged);
}

/** Explicit season id */
export async function getCalendarForSeason(seasonId: number): Promise<CalendarItem[]> {
    const [events, wp]: [DbEvent[], WpEvent[]] = await Promise.all([
        fetchEventsBySeason(seasonId),
        fetchSportevenementen(1, 100),
    ]);

    const merged = mergeEventsWithWp(events, wp);
    return await attachMainQuestionCounts(merged);
}