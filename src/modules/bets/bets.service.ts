// src/modules/bets/bets.service.ts
import { BetsRepo } from "./bets.repo";

type Kind = "main" | "sub" | "bonus";

export class BetsService {
    constructor(private repo: BetsRepo) {}

    async getBetQuestions(betId: number) {
        const betTitle = (await this.repo.getBetTitle(betId)) ?? `Bet ${betId}`;
        const qs = await this.repo.getQuestionsWithRt(betId);

        // Group/subs map
        const childrenMap = await this.repo.getBlockChildrenMapForBet(betId);

        // List questions
        const listQids = qs.filter(q => q.rtLabel === "list").map(q => Number(q.id));

        // List metadata (flags + listId) per question
        const listMetaRows = await this.repo.getListMetaForQuestions(listQids);
        const listMetaByQid = new Map<
            number,
            { listId: number; disableOrder: boolean; noDoubleTeam: boolean; noDoubleLabel: boolean; showTeams: boolean }
            >();
        for (const r of listMetaRows) {
            listMetaByQid.set(Number(r.questionId), {
                listId: Number(r.listId),
                disableOrder: String(r.disableOrder) === "1",
                noDoubleTeam: String(r.noDoubleTeam) === "1",
                noDoubleLabel: String(r.noDoubleLabel) === "1",
                showTeams: String(r.showTeams) === "1",
            });
        }

        // List items per question (ordered by li.id for DB order)
        const listRows = await this.repo.getListItemsForQuestions(listQids);
        const itemsByQid = new Map<number, any[]>();
        for (const r of listRows) {
            const arr = itemsByQid.get(r.questionId) ?? [];
            arr.push({
                id: Number(r.listItemId),
                label: String(r.itemLabel),
                country: r.countryCode ? { code: String(r.countryCode) } : null,
                team: (r.teamId != null || r.teamAbbr || r.teamFg || r.teamBg)
                    ? {
                        id: r.teamId != null ? Number(r.teamId) : null,
                        abbr: r.teamAbbr ?? null,
                        fg: r.teamFg ?? null,
                        bg: r.teamBg ?? null,
                    }
                    : null,
            });
            itemsByQid.set(Number(r.questionId), arr);
        }

        // Leagues
        const qids = qs.map(q => Number(q.id));
        const leagueRows = await this.repo.getLeaguesForQuestions(qids);
        const leaguesByQid = new Map<number, Array<{ id: number; label: string; icon: string }>>();
        for (const r of leagueRows) {
            const arr = leaguesByQid.get(r.questionId) ?? [];
            arr.push({ id: Number(r.id), label: String(r.label ?? ""), icon: String(r.icon ?? "") });
            leaguesByQid.set(Number(r.questionId), arr);
        }

        // Kind + displayPoints
        const byGroup = new Map<number, any[]>();
        for (const q of qs) {
            const gc = Number(q.groupCode);
            if (!byGroup.has(gc)) byGroup.set(gc, []);
            byGroup.get(gc)!.push(q);
        }

        const kindById = new Map<number, Kind>();
        const displayPtsById = new Map<number, number>();

        for (const [_gc, group] of byGroup) {
            const mains = group.filter(r => r.parentId == null);
            if (mains.length !== 1) {
                for (const r of group) {
                    const id = Number(r.id);
                    kindById.set(id, r.parentId == null ? "main" : (Number(r.points || 0) === 0 ? "sub" : "bonus"));
                    displayPtsById.set(id, r.parentId == null ? 20 : 0);
                }
                continue;
            }

            const main = mains[0];
            const mainId = Number(main.id);
            const subs = group.filter(r => r.parentId != null && Number(r.points || 0) === 0);
            const bonuses = group.filter(r => r.parentId != null && Number(r.points || 0) !== 0);

            if (subs.length === 0 && bonuses.length === 0) {
                kindById.set(mainId, "main");
                displayPtsById.set(mainId, 20);
                continue;
            }

            if (bonuses.length === 0) {
                kindById.set(mainId, "main");
                displayPtsById.set(mainId, 20);
                for (const s of subs) {
                    kindById.set(Number(s.id), "sub");
                    displayPtsById.set(Number(s.id), 0);
                }
                continue;
            }

            kindById.set(mainId, "main");
            const mainPts = Number(main.points || 0);
            displayPtsById.set(mainId, mainPts);

            const orderedBonuses = bonuses
                .slice()
                .sort((a, b) => Number(a.lineup) - Number(b.lineup));
            let remainder = Math.max(0, 20 - mainPts);
            orderedBonuses.forEach((b, idx) => {
                const id = Number(b.id);
                kindById.set(id, "bonus");
                displayPtsById.set(id, idx === 0 ? remainder : 0);
            });

            for (const s of subs) {
                kindById.set(Number(s.id), "sub");
                displayPtsById.set(Number(s.id), 0);
            }
        }

        const questions = qs.map((q: any) => {
            const id = Number(q.id);
            const leaguesRaw = leaguesByQid.get(id) ?? [];
            const leagues = leaguesRaw.filter(l => l.id !== 1 && l.id !== 2);

            const listMeta = listMetaByQid.get(id);
            const listPayload =
                q.rtLabel === "list"
                    ? {
                        id: listMeta?.listId ?? null,
                        meta: listMeta
                            ? {
                                disableOrder: !!listMeta.disableOrder,
                                noDoubleTeam: !!listMeta.noDoubleTeam,
                                noDoubleLabel: !!listMeta.noDoubleLabel,
                                showTeams: !!listMeta.showTeams,
                            }
                            : null,
                        items: itemsByQid.get(id) ?? [],
                    }
                    : undefined;

            return {
                id,
                parentId: q.parentId != null ? Number(q.parentId) : null,
                groupCode: Number(q.groupCode),
                lineup: Number(q.lineup),
                points: Number(q.points),
                margin: q.margin != null ? Number(q.margin) : null,
                step: q.step != null ? Number(q.step) : null,
                block: String(q.block) === "1",
                title: q.title ?? null,
                label: q.label,
                descr: q.descr ?? null,
                sportId: q.sportId != null ? Number(q.sportId) : null,
                sportLabel: q.sportLabel ?? null,
                resultType: {
                    id: Number(q.rtId),
                    label: String(q.rtLabel),
                    regex: q.rtRegex ?? null,
                    info: q.rtInfo ?? null,
                    placeholder: q.rtPlaceholder ?? null,
                },
                kind: (kindById.get(id) ??
                    (q.parentId == null ? "main" : (Number(q.points || 0) === 0 ? "sub" : "bonus"))) as Kind,
                displayPoints: displayPtsById.get(id) ?? 0,
                blockChildren: (childrenMap.get(Number(q.groupCode)) ?? []) as number[],
                leagues,
                list: listPayload,
            };
        });

        return { betId, betTitle, questions };
    }
}