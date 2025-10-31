// src/modules/classification/classification.service.ts
import type { PageOptions } from "./classification.repo";
import * as repo from "./classification.repo";
import type {
    Classification,
    ClassificationExpanded,
    PageResult,
} from "../../types/domain";
import { parseExpand } from "../../utils/expand";
import { mapLeagues, mapSeasons, mapUsers } from "../../data/lookups";

// NEW: recompute movement for virtual vs latest real
import { applyMovementAgainstBaseline } from "./movement";

export async function list(
    opts: PageOptions & { expand?: string | string[] }
): Promise<PageResult<Classification | ClassificationExpanded>> {
    const base = await repo.getClassificationPage(opts);
    const ex = parseExpand(opts.expand);
    if (ex.size === 0 || base.data.length === 0) return base;

    const seasonIds = ex.has("season") ? [...new Set(base.data.map((r) => r.season_id))] : [];
    const leagueIds = ex.has("league") ? [...new Set(base.data.map((r) => r.league_id))] : [];
    const userIds   = ex.has("user")   ? [...new Set(base.data.map((r) => r.user_id))]   : [];

    const [seasonMap, leagueMap, userMap] = await Promise.all([
        ex.has("season") ? mapSeasons(seasonIds) : Promise.resolve(new Map()),
        ex.has("league") ? mapLeagues(leagueIds) : Promise.resolve(new Map()),
        ex.has("user")   ? mapUsers(userIds)     : Promise.resolve(new Map()),
    ]);

    const enriched = base.data.map((r) => ({
        ...r,
        ...(ex.has("season") ? { season: seasonMap.get(r.season_id) ?? null } : {}),
        ...(ex.has("league") ? { league: leagueMap.get(r.league_id) ?? null } : {}),
        ...(ex.has("user")   ? { user:   userMap.get(r.user_id)     ?? null } : {}),
    }));

    return { ...base, data: enriched };
}

export async function current(
    season_id: number,
    league_id: number,
    isVirtual: boolean,
    expand?: string | string[]
) {
    const { sequence, rows } = await repo.getCurrentStandings(season_id, league_id, isVirtual);
    const ex = parseExpand(expand);
    if (rows.length === 0) return { sequence, standings: rows as Classification[] };

    let rowsFinal: Classification[] = rows as Classification[];

    // --- NEW: If virtual, recompute movement vs latest REAL standings (not prev virtual) ---
    if (isVirtual) {
        const latestRealSeq = await repo.getLatestSequence(season_id, league_id, /*isVirtual*/ false);
        if (latestRealSeq) {
            const latestReal = await repo.getStandingsAtSequence(season_id, league_id, latestRealSeq, /*isVirtual*/ false);
            rowsFinal = applyMovementAgainstBaseline(rowsFinal, latestReal);
        }
    }

    if (ex.size === 0) return { sequence, standings: rowsFinal };

    const [seasonMap, leagueMap, userMap] = await Promise.all([
        ex.has("season") ? mapSeasons([season_id]) : Promise.resolve(new Map()),
        ex.has("league") ? mapLeagues([league_id]) : Promise.resolve(new Map()),
        ex.has("user")   ? mapUsers([...new Set(rowsFinal.map((r) => r.user_id))]) : Promise.resolve(new Map()),
    ]);

    const standings = rowsFinal.map((r) => ({
        ...r,
        ...(ex.has("season") ? { season: seasonMap.get(r.season_id) ?? null } : {}),
        ...(ex.has("league") ? { league: leagueMap.get(r.league_id) ?? null } : {}),
        ...(ex.has("user")   ? { user:   userMap.get(r.user_id)     ?? null } : {}),
    })) as ClassificationExpanded[];

    return { sequence, standings };
}

export async function standingsAt(
    season_id: number,
    league_id: number,
    sequence: number,
    isVirtual: boolean,
    expand?: string | string[]
) {
    const rows = await repo.getStandingsAtSequence(season_id, league_id, sequence, isVirtual);
    const ex = parseExpand(expand);
    if (rows.length === 0) return { sequence, standings: rows as Classification[] };

    let rowsFinal: Classification[] = rows as Classification[];

    // --- NEW: If virtual, recompute movement vs latest REAL standings (not previous virtual) ---
    if (isVirtual) {
        const latestRealSeq = await repo.getLatestSequence(season_id, league_id, /*isVirtual*/ false);
        if (latestRealSeq) {
            const latestReal = await repo.getStandingsAtSequence(season_id, league_id, latestRealSeq, /*isVirtual*/ false);
            rowsFinal = applyMovementAgainstBaseline(rowsFinal, latestReal);
        }
    }

    if (ex.size === 0) return { sequence, standings: rowsFinal };

    const [seasonMap, leagueMap, userMap] = await Promise.all([
        ex.has("season") ? mapSeasons([season_id]) : Promise.resolve(new Map()),
        ex.has("league") ? mapLeagues([league_id]) : Promise.resolve(new Map()),
        ex.has("user")   ? mapUsers([...new Set(rowsFinal.map((r) => r.user_id))]) : Promise.resolve(new Map()),
    ]);

    const standings = rowsFinal.map((r) => ({
        ...r,
        ...(ex.has("season") ? { season: seasonMap.get(r.season_id) ?? null } : {}),
        ...(ex.has("league") ? { league: leagueMap.get(r.league_id) ?? null } : {}),
        ...(ex.has("user")   ? { user:   userMap.get(r.user_id)     ?? null } : {}),
    })) as ClassificationExpanded[];

    return { sequence, standings };
}

export async function userProgression(
    season_id: number,
    league_id: number,
    user_id: number,
    isVirtual: boolean
) {
    return repo.getUserProgression(season_id, league_id, user_id, isVirtual);
}

export async function leagueTrend(
    season_id: number,
    league_id: number,
    from: number,
    to: number,
    isVirtual: boolean,
    expand?: string | string[]
) {
    const rows = await repo.getLeagueTrend(season_id, league_id, from, to, isVirtual);
    const ex = parseExpand(expand);
    if (ex.size === 0 || rows.length === 0) return { from, to, rows: rows as Classification[] };

    const [seasonMap, leagueMap, userMap] = await Promise.all([
        ex.has("season") ? mapSeasons([season_id]) : Promise.resolve(new Map()),
        ex.has("league") ? mapLeagues([league_id]) : Promise.resolve(new Map()),
        ex.has("user")   ? mapUsers([...new Set(rows.map((r) => r.user_id))]) : Promise.resolve(new Map()),
    ]);

    const enriched = rows.map((r) => ({
        ...r,
        ...(ex.has("season") ? { season: seasonMap.get(r.season_id) ?? null } : {}),
        ...(ex.has("league") ? { league: leagueMap.get(r.league_id) ?? null } : {}),
        ...(ex.has("user")   ? { user:   userMap.get(r.user_id)     ?? null } : {}),
    }));

    return { from, to, rows: enriched };
}