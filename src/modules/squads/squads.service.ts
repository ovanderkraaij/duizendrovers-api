// src/modules/squads/squads.service.ts
import type { SquadStanding, SquadStandingsResponse, SquadMember } from "../../types/domain";
import * as repo from "./squads.repo";

/** Build per-squad totals for a given classification snapshot (sequence). */
function computeSquadTotalsAtSequence(
    squads: Array<{ id: number; label: string }>,
    membersBySquad: Map<number, SquadMember[]>,
    smallestSquadSize: number,
    classRows: Array<{ user_id: number; question_id: number; score: number }>
) {
    const byQuestion = new Map<number, Array<{ user_id: number; score: number }>>();
    for (const r of classRows) {
        if (!byQuestion.has(r.question_id)) byQuestion.set(r.question_id, []);
        byQuestion.get(r.question_id)!.push({ user_id: r.user_id, score: r.score || 0 });
    }

    const questionIds = Array.from(byQuestion.keys());
    const standings: Array<SquadStanding & { _work_prev?: number }> = [];

    for (const s of squads) {
        const members = membersBySquad.get(s.id) ?? [];
        const k = members.length;
        if (k === 0 || questionIds.length === 0) {
            standings.push({
                squadId: s.id,
                label: s.label,
                score: 0,
                previousScore: 0,
                seed: 0,
                previousSeed: 0,
                evolution: "equal",
                perUserTotals: {},
                members,
            });
            continue;
        }

        const factor = k > 0 && smallestSquadSize > 0 ? smallestSquadSize / k : 1;

        let total = 0;
        const perUserTotals: Record<number, number> = {};

        for (const q of questionIds) {
            const scores: number[] = [];
            const list = byQuestion.get(q)!;
            for (const m of members) {
                const row = list.find((r) => r.user_id === m.user_id);
                if (!row) continue;
                let v = row.score || 0;
                if (m.is_captain) v *= 2; // captain bonus
                scores.push(v);
                perUserTotals[m.user_id] = (perUserTotals[m.user_id] || 0) + v;
            }

            if (scores.length === 0) continue;

            if (scores.length >= 2) {
                scores.sort((a, b) => b - a); // desc
                scores.pop(); // drop worst
            }
            const sum = scores.reduce((acc, v) => acc + v, 0) * factor;
            total += sum;
        }

        standings.push({
            squadId: s.id,
            label: s.label,
            score: round2(total),
            previousScore: 0,
            seed: 0,
            previousSeed: 0,
            evolution: "equal",
            perUserTotals,
            members,
        });
    }

    return standings;
}

/** Assign seeds (1-based, ties share seed), tie-break by label ASC. */
function assignSeeds<T extends { score: number; label: string }>(
    rows: T[]
): Array<T & { seed: number }> {
    const sorted = [...rows].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.label.localeCompare(b.label, "nl", { sensitivity: "base" });
    });
    let seed = 0;
    let lastScore: number | null = null;
    return sorted.map((r, idx) => {
        if (lastScore == null || r.score < lastScore) {
            seed = idx + 1;
            lastScore = r.score;
        }
        return { ...r, seed };
    });
}

/** Round to 2 decimals for stable JSON. */
function round2(n: number) {
    return Math.round(n * 100) / 100;
}

/**
 * Public service: compute squad standings for a season + (virtual|real).
 * - leagueId is fixed to 1 (score league).
 */
export async function getSquadStandings(
    seasonIdParam: number | "current",
    isVirtual: boolean
): Promise<SquadStandingsResponse> {
    const seasonId =
        seasonIdParam === "current" ? (await repo.getOpenSeasonId())! : Number(seasonIdParam);
    if (!seasonId) {
        return {
            seasonId: 0,
            leagueId: 1,
            virtual: isVirtual,
            sequence: 0,
            previousSequence: null,
            smallestSquadSize: 0,
            standings: [],
        };
    }

    const leagueId = 1; // per rules

    // ⬇️ Fetch separately to avoid Promise.all tuple → union inference
    const membersData = await repo.getSeasonSquadMembers(seasonId);
    const squads = await repo.getSquadsWithMembers(seasonId);
    const { bySquad, smallest } = membersData;

    const latest = await repo.getLatestSequence(seasonId, leagueId, isVirtual);
    if (!latest) {
        return {
            seasonId,
            leagueId,
            virtual: isVirtual,
            sequence: 0,
            previousSequence: null,
            smallestSquadSize: smallest,
            standings: [],
        };
    }
    const prev = latest - 1 > 0 ? latest - 1 : 0;

    const [rowsLatest, rowsPrev] = await Promise.all([
        repo.getClassRowsAtSequence(seasonId, leagueId, latest, isVirtual),
        prev ? repo.getClassRowsAtSequence(seasonId, leagueId, prev, isVirtual) : Promise.resolve([]),
    ]);

    const currentRows = computeSquadTotalsAtSequence(squads, bySquad, smallest, rowsLatest);
    const prevRows =
        prev && rowsPrev.length
            ? computeSquadTotalsAtSequence(squads, bySquad, smallest, rowsPrev)
            : currentRows.map((r) => ({ ...r })); // mirror if no previous

    const withSeedsPrev = assignSeeds(prevRows);
    const withSeedsCurr = assignSeeds(currentRows);

    const prevSeedScore = new Map<number, { seed: number; score: number }>();
    for (const p of withSeedsPrev) {
        prevSeedScore.set(p.squadId, { seed: p.seed, score: p.score });
    }

    const finalCurr = withSeedsCurr.map((c) => {
        const prevInfo = prevSeedScore.get(c.squadId);
        const prevSeed = prevInfo ? prevInfo.seed : c.seed;
        const prevScore = prevInfo ? prevInfo.score : c.score;
        const evolution = prevSeed > c.seed ? "up" : prevSeed < c.seed ? "down" : "equal";
        return {
            ...c,
            previousSeed: prevSeed,
            previousScore: round2(prevScore),
            evolution,
        };
    });

    return {
        seasonId,
        leagueId,
        virtual: isVirtual,
        sequence: latest,
        previousSequence: prev || null,
        smallestSquadSize: smallest,
        standings: finalCurr,
    };
}

/** Convenience: return only the squad(s) that contain the given userId. */
export async function getMySquadStanding(
    seasonIdParam: number | "current",
    isVirtual: boolean,
    userId: number
) {
    const full = await getSquadStandings(seasonIdParam, isVirtual);
    if (full.standings.length === 0) return full;

    const mine = full.standings.filter((s) => {
        const mem = s.members ?? [];
        return mem.some((m) => m.user_id === userId);
    });

    return { ...full, standings: mine };
}