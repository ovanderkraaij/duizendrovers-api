// src/modules/calendar/wp.client.ts
import { env } from "../../config/env";

export type WpEvent = {
    wpId: number;
    title: string;
    imageUrl: string | null;
    commentCount: number;
    hasVideo: boolean;
    eventId: number | null;
    temporaryDeadline: string | null; // as returned by WP; FE treats as end-of-day if only date
    slug: string | null;
};

export async function fetchSportevenementen(page = 1, perPage = 100): Promise<WpEvent[]> {
    const url = new URL(`${env.wp.base}/sportevenement`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("_embed", "1");

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`WP fetch failed: ${res.status} ${res.statusText}`);

    const posts: any[] = await res.json();

    return posts.map((p: any): WpEvent => {
        const meta = p.meta ?? {};
        const img = p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null;

        return {
            wpId: p.id,
            title: p.title?.rendered ?? "",
            imageUrl: img,
            commentCount: p.comment_count ?? 0,
            hasVideo: !!(p.acf?.has_video ?? false),
            eventId: meta.event_id ? Number(meta.event_id) : null,
            temporaryDeadline: meta._temporary_deadline || null, // WP stores as "dd-MM-yyyy" (e.g. "14-07-2019")
            slug: p.slug ?? null
        };
    });
}