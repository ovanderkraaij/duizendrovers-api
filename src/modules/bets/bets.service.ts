// src/modules/bets/bets.service.ts
import { BetsRepo } from "./bets.repo";
import { AnswersRepo } from "../answers/answers.repo";
import { SolutionsRepo } from "../solutions/solutions.repo";

type Kind = "main" | "sub" | "bonus";

export class BetsService {
    constructor(
        private repo: BetsRepo,
        private answers?: AnswersRepo,
        private solutions?: SolutionsRepo
    ) {}

    async getBetQuestions(betId: number) {
        const betTitle = (await this.repo.getBetTitle(betId)) ?? `Bet ${betId}`;
        const qs = await this.repo.getQuestionsWithRt(betId);

        const childrenMap = await this.repo.getBlockChildrenMapForBet(betId);

        const listQids = qs.filter((q) => q.rtLabel === "list").map((q) => Number(q.id));
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

        const listRows = await this.repo.getListItemsForQuestions(listQids);
        const itemsByQid = new Map<number, any[]>();
        for (const r of listRows) {
            const arr = itemsByQid.get(r.questionId) ?? [];
            arr.push({
                id: Number(r.listItemId),
                label: String(r.itemLabel),
                country: r.countryCode ? { code: String(r.countryCode) } : null,
                team:
                    r.teamId != null || r.teamAbbr || r.teamFg || r.teamBg
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

        const qids = qs.map((q) => Number(q.id));
        const leagueRows = await this.repo.getLeaguesForQuestions(qids);
        const leaguesByQid = new Map<number, Array<{ id: number; label: string; icon: string }>>();
        for (const r of leagueRows) {
            const arr = leaguesByQid.get(r.questionId) ?? [];
            arr.push({ id: Number(r.id), label: String(r.label ?? ""), icon: String(r.icon ?? "") });
            leaguesByQid.set(r.questionId, arr);
        }

        const byGroup = new Map<number, any[]>();
        for (const q of qs) {
            const gc = Number(q.groupCode);
            if (!byGroup.has(gc)) byGroup.set(gc, []);
            byGroup.get(gc)!.push(q);
        }

        const kindById = new Map<number, Kind>();
        const displayPtsById = new Map<number, number>();

        for (const [_gc, group] of byGroup) {
            const mains = group.filter((r) => r.parentId == null);
            if (mains.length !== 1) {
                for (const r of group) {
                    const id = Number(r.id);
                    kindById.set(
                        id,
                        r.parentId == null ? "main" : Number(r.points || 0) === 0 ? "sub" : "bonus"
                    );
                    displayPtsById.set(id, r.parentId == null ? 20 : 0);
                }
                continue;
            }

            const main = mains[0];
            const mainId = Number(main.id);
            const subs = group.filter((r) => r.parentId != null && Number(r.points || 0) === 0);
            const bonuses = group.filter((r) => r.parentId != null && Number(r.points || 0) !== 0);

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

            const orderedBonuses = bonuses.slice().sort((a, b) => Number(a.lineup) - Number(b.lineup));
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

        const isScoreSport = (rt: string) => {
            const s = String(rt || "").toLowerCase();
            return s === "football" || s === "hockey";
        };

        const splitMatch = (label: string) => {
            const raw = (label || "").trim();
            if (!raw) return null;
            const parts = raw
                .split(/-|—|–|vs\.?|v\.?/i)
                .map((p) => p.trim())
                .filter(Boolean);
            if (parts.length !== 2) return null;
            return { homeLabel: parts[0], awayLabel: parts[1] };
        };

        const neededLabels: string[] = [];
        const parsedByQid = new Map<number, { homeLabel: string; awayLabel: string }>();

        for (const q of qs) {
            if (!isScoreSport(q.rtLabel)) continue;
            const parsed = splitMatch(q.label ?? "");
            if (!parsed) continue;
            parsedByQid.set(Number(q.id), parsed);
            neededLabels.push(parsed.homeLabel, parsed.awayLabel);
        }

        const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
        const uniqNorm = Array.from(new Set(neededLabels.map(normalize)));

        const resolvedRows = await this.repo.getItemsByLabels(uniqNorm);
        const byNormLabel = new Map<
            string,
            { countryCode: string | null; teamAbbr: string | null; teamId: number | null }
            >();
        for (const r of resolvedRows as any[]) {
            const key = String(r.normLabel || "").trim();
            byNormLabel.set(key, {
                countryCode: r.countryCode ?? null,
                teamAbbr: r.teamAbbr ?? null,
                teamId: r.teamId != null ? Number(r.teamId) : null,
            });
        }

        const questions = qs.map((q: any) => {
            const id = Number(q.id);
            const leaguesRaw = leaguesByQid.get(id) ?? [];
            const leagues = leaguesRaw;

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

            let match: any = null;
            if (isScoreSport(q.rtLabel)) {
                const parsed = parsedByQid.get(id);
                if (parsed) {
                    const h = byNormLabel.get(normalize(parsed.homeLabel));
                    const a = byNormLabel.get(normalize(parsed.awayLabel));
                    match = {
                        homeLabel: parsed.homeLabel,
                        awayLabel: parsed.awayLabel,
                        homeCountryCode: h?.countryCode ?? null,
                        awayCountryCode: a?.countryCode ?? null,
                    };
                }
            }

            return {
                id,
                parentId: q.parentId != null ? Number(q.parentId) : null,
                groupCode: Number(q.groupCode),
                lineup: Number(q.lineup),
                points: Number(q.points),
                margin: q.margin != null ? Number(q.margin) : null,
                step: q.step != null ? Number(q.step) : null,
                block: String(q.block) === "1",
                virtual: String(q.virtual) === "1",
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
                kind:
                    (kindById.get(id) ??
                        (q.parentId == null ? "main" : Number(q.points || 0) === 0 ? "sub" : "bonus")) as Kind,
                displayPoints: displayPtsById.get(id) ?? 0,
                blockChildren: (childrenMap.get(Number(q.groupCode)) ?? []) as number[],
                leagues,
                list: listPayload,
                match,
            };
        });

        return { betId, betTitle, questions };
    }

    /**
     * Historical stats for all past bets with the same label as the given bet.
     */
    async getBetHistoryByName(betId: number, userId?: number) {
        const meta = await this.repo.getBetLabelAndSeason(betId);
        if (!meta) {
            return {
                bet_id: betId,
                label: null,
                editions: [] as any[],
            };
        }

        const { label, seasonId } = meta;
        const past = await this.repo.getPastBetsWithSameLabel(label, seasonId, betId);

        const editions: Array<{
            bet_id: number;
            season_id: number;
            season_label: string;
            virtual: boolean;
            participation_pct: number;
            total_max_score: number;
            total_your_score: number;
            part_of_season: boolean;
            number_of_bundles: number;
            bundles: Array<{ group_code: number; max_score: number; your_score: number }>;
        }> = [];

        const hasUser = userId != null && Number.isFinite(userId);

        for (const ed of past) {
            const [bundleRows, isVirtual] = await Promise.all([
                this.repo.getBundleMaxScoresForBet(ed.betId),
                this.repo.isBetVirtual(ed.betId),
            ]);

            let userBundleRows: Array<{ groupCode: number; yourScore: number }> = [];
            let partOfSeason = false;

            if (hasUser) {
                const uid = Number(userId);
                [userBundleRows, partOfSeason] = await Promise.all([
                    this.repo.getBundleScoresForBetAndUser(ed.betId, uid),
                    this.repo.isUserInSeason(ed.seasonId, uid),
                ]);
            }

            const userScoreByGroup = new Map<number, number>();
            for (const r of userBundleRows) {
                userScoreByGroup.set(r.groupCode, Number(r.yourScore || 0));
            }

            const bundles = bundleRows
                .slice()
                .sort((a, b) => a.groupCode - b.groupCode)
                .map((b) => {
                    const yourScore = userScoreByGroup.get(b.groupCode) ?? 0;
                    return {
                        group_code: b.groupCode,
                        max_score: b.maxScore,
                        your_score: yourScore,
                    };
                });

            const totalMaxScore = bundles.reduce(
                (sum, b) => sum + (Number(b.max_score) || 0),
                0
            );
            const totalYourScore = bundles.reduce(
                (sum, b) => sum + (Number(b.your_score) || 0),
                0
            );
            const numberOfBundles = bundles.length;

            const firstMainId = await this.repo.getFirstMainQuestionId(ed.betId);
            const totalUsers = await this.repo.countSeasonUsers(ed.seasonId);

            let participationPct = 0;
            if (firstMainId && totalUsers > 0) {
                const participants = await this.repo.countParticipantsForQuestion(firstMainId);
                if (participants > 0) {
                    const raw = (participants / totalUsers) * 100;
                    participationPct = Math.round(raw * 100) / 100;
                }
            }

            editions.push({
                bet_id: ed.betId,
                season_id: ed.seasonId,
                season_label: ed.seasonLabel,
                virtual: isVirtual,
                participation_pct: participationPct,
                total_max_score: totalMaxScore,
                total_your_score: hasUser ? totalYourScore : 0,
                part_of_season: hasUser ? partOfSeason : false,
                number_of_bundles: numberOfBundles,
                bundles,
            });
        }

        return {
            bet_id: betId,
            label,
            editions,
        };
    }

    /**
     * New: Bundles DTO for a bet, including per-question metadata and per-user predictions.
     * Returns exactly the structure we agreed for /bets/bundles.
     *
     * Enriched: each question now includes `solutions: [...]` with all official solutions
     * for that question (supports multiple solutions).
     */
    async getBetBundles(betId: number, userId: number) {
        const meta = await this.repo.getBetMeta(betId);
        if (!meta) {
            return {
                bet_id: betId,
                label: null,
                deadline: null,
                bundles: [] as any[],
            };
        }

        const { questions } = await this.getBetQuestions(betId);

        // Load all solutions for all questions in this bet (if SolutionsRepo is injected)
        const allQids = questions.map((q: any) => Number(q.id));
        const solutionsByQid = new Map<
            number,
            Array<{ result: string | null; listitem_id: number | null }>
            >();
        if (this.solutions && allQids.length > 0) {
            const solRows = await this.solutions.getSolutionsForQids(allQids);
            for (const r of solRows as any[]) {
                const qid = Number(r.question_id);
                const arr = solutionsByQid.get(qid) ?? [];
                arr.push({
                    result: r.result != null ? String(r.result) : null,
                    listitem_id: r.listitem_id != null ? Number(r.listitem_id) : null,
                });
                solutionsByQid.set(qid, arr);
            }
        }

        // Global question numbering: only MAIN + first BONUS (displayPoints > 0) count.
        const sortedQuestions = questions
            .slice()
            .sort((a: any, b: any) => {
                if (a.groupCode !== b.groupCode) return a.groupCode - b.groupCode;
                return a.lineup - b.lineup;
            });
        const eventQuestionNumber = new Map<number, number>();
        let counter = 0;
        for (const q of sortedQuestions as any[]) {
            const isMain = q.kind === "main";
            const isFirstBonus = q.kind === "bonus" && (q.displayPoints ?? 0) > 0;
            if (isMain || isFirstBonus) {
                counter += 1;
                eventQuestionNumber.set(q.id, counter);
            }
        }

        // Group questions into bundles by groupCode
        const groups = new Map<number, any[]>();
        for (const q of questions as any[]) {
            const gc = Number(q.groupCode);
            if (!groups.has(gc)) groups.set(gc, []);
            groups.get(gc)!.push(q);
        }

        // Load all answers for this user & bet
        const answersByQid = new Map<
            number,
            Array<{
                questionId: number;
                label: string | null;
                result: string | null;
                listItemId: number | null;
                points: number;
                score: number;
                correct: string | number | null;
                posted: string | number | null;
            }>
            >();

        if (!this.answers) {
            throw new Error("AnswersRepo not provided to BetsService");
        }

        const answerRows = await this.answers.getAllForBetUser(betId, userId);
        for (const r of answerRows as any[]) {
            const qid = Number(r.questionId);
            const arr = answersByQid.get(qid) ?? [];
            arr.push({
                questionId: qid,
                label: r.label != null ? String(r.label) : null,
                result: r.result != null ? String(r.result) : null,
                listItemId: r.listItemId != null ? Number(r.listItemId) : null,
                points: Number(r.points ?? 0),
                score: Number(r.score ?? 0),
                correct: r.correct ?? null,
                posted: r.posted ?? null,
            });
            answersByQid.set(qid, arr);
        }

        const bundles: any[] = [];
        let bundleIndex = 0;

        const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);

        for (const [groupCode, rawGroup] of sortedGroups) {
            bundleIndex += 1;
            const group = rawGroup.slice().sort((a: any, b: any) => a.lineup - b.lineup);

            const main = group.find((q: any) => q.kind === "main") ?? group.find((q: any) => q.parentId == null);
            const bonuses = group.filter((q: any) => q.kind === "bonus");
            bonuses.sort((a: any, b: any) => a.lineup - b.lineup);
            const firstBonus = bonuses[0] ?? null;
            const isVirtual = !!group.find((q: any) => q.virtual == 1 || q.virtual === "1");

            const questionsDto: any[] = [];
            let bundleScoreTotal = 0;

            group.forEach((q: any, idx: number) => {
                const qid = Number(q.id);
                const hasMargin = q.margin != null && q.step != null;
                const isBonus = q.kind === "bonus";
                const isList = String(q.resultType.label || "").toLowerCase() === "list";

                const listConfig =
                    isList && q.list?.meta
                        ? {
                            disable_order: !!q.list.meta.disableOrder,
                            no_double_team: !!q.list.meta.noDoubleTeam,
                            no_double_label: !!q.list.meta.noDoubleLabel,
                            show_teams: !!q.list.meta.showTeams,
                        }
                        : null;

                const listItems = isList
                    ? (q.list?.items ?? []).map((it: any) => ({
                        listitem_id: it.id,
                        label: it.label,
                        country: it.country ?? null,
                        team: it.team ?? null,
                    }))
                    : [];

                const ansRows =
                    answersByQid.get(qid) ??
                    ([] as Array<{
                        label: string | null;
                        result: string | null;
                        listItemId: number | null;
                        points: number;
                        score: number;
                        correct: string | number | null;
                        posted: string | number | null;
                    }>);

                let hasAnswer = ansRows.length > 0;
                let userScore = 0;
                let isCorrect = false;
                let center: (typeof ansRows)[number] | null = null;

                for (const a of ansRows) {
                    userScore += Number(a.score || 0);
                    const corr = a.correct;
                    if (corr === 1 || corr === "1") {
                        isCorrect = true;
                    }
                    const posted = a.posted;
                    if (!center && (posted === 1 || posted === "1")) {
                        center = a;
                    }
                }
                if (!center && ansRows[0]) {
                    center = ansRows[0];
                }

                bundleScoreTotal += userScore;

                let marginVariants: any[] | null = null;
                if (hasMargin && ansRows.length > 0) {
                    const sorted = ansRows
                        .slice()
                        .sort((a, b) => {
                            const av = Number(a.result);
                            const bv = Number(b.result);
                            if (Number.isFinite(av) && Number.isFinite(bv)) {
                                return av - bv;
                            }
                            return String(a.result ?? "").localeCompare(String(b.result ?? ""));
                        });
                    marginVariants = sorted.map((a) => ({
                        label: a.label ?? "",
                        result: a.result ?? "",
                        is_center: center ? a === center : false,
                        is_scoring: Number(a.score || 0) > 0,
                    }));
                }

                const prediction =
                    hasAnswer && center
                        ? {
                            primary_label: center.label ?? "",
                            listitem_id: center.listItemId,
                            result: center.result,
                            margin_variants: marginVariants ?? [],
                        }
                        : null;

                // Enrich with official solutions for this question (multiple allowed)
                const solRowsForQ = solutionsByQid.get(qid) ?? [];
                let solutionsDto: any[] = [];
                if (solRowsForQ.length > 0) {
                    const listItemMetaById = new Map<
                        number,
                        { label: string; country: any; team: any }
                        >();
                    if (isList) {
                        for (const it of listItems) {
                            listItemMetaById.set(Number(it.listitem_id), {
                                label: it.label,
                                country: it.country,
                                team: it.team,
                            });
                        }
                    }

                    solutionsDto = solRowsForQ.map((s) => {
                        const li = s.listitem_id;
                        let label: string | null = null;
                        let country: any = null;
                        let team: any = null;

                        if (li != null && isList) {
                            const meta = listItemMetaById.get(li);
                            if (meta) {
                                label = meta.label;
                                country = meta.country;
                                team = meta.team;
                            }
                        }

                        return {
                            result: s.result,
                            listitem_id: li,
                            label,
                            country,
                            team,
                        };
                    });
                }

                const questionDto = {
                    id: qid,
                    kind: q.kind as Kind,
                    sequence_in_bundle: idx + 1,
                    question_number_in_event: eventQuestionNumber.get(qid) ?? null,
                    label: q.label,
                    has_margin: hasMargin,
                    is_bonus_entry: isBonus,
                    is_first_bonus: isBonus && idx == 1,
                    superscript: hasMargin ? "±" : isBonus ? "bonus" : "",
                    points_display: q.displayPoints ?? 0,
                    result_type: {
                        id: q.resultType.id,
                        label: q.resultType.label,
                        is_list: isList,
                    },
                    sport:
                        q.sportId != null || q.sportLabel != null
                            ? {
                                id: q.sportId ?? null,
                                label: q.sportLabel ?? null,
                            }
                            : null,
                    leagues: q.leagues ?? [],
                    list_config: listConfig,
                    list_items: listItems,
                    solutions: solutionsDto,
                    user: {
                        has_answer: hasAnswer,
                        score: userScore,
                        is_correct: isCorrect,
                        prediction,
                    },
                };

                questionsDto.push(questionDto);
            });

            const bundleDto = {
                group_code: groupCode,
                bundle_index: bundleIndex,
                your_score_total: bundleScoreTotal,
                main_question_number: main ? eventQuestionNumber.get(main.id) ?? null : null,
                bonus_question_number: firstBonus ? eventQuestionNumber.get(firstBonus.id) ?? null : null,
                bundle_virtual: isVirtual == true,
                questions: questionsDto,
            };

            bundles.push(bundleDto);
        }

        let deadlineIso: string | null = null;
        if (meta.deadline != null) {
            const d =
                meta.deadline instanceof Date
                    ? meta.deadline
                    : new Date(meta.deadline as string);
            if (!Number.isNaN(d.getTime())) {
                deadlineIso = d.toISOString();
            }
        }

        return {
            bet_id: betId,
            label: meta.label,
            deadline: deadlineIso,
            bundles,
        };
    }
}

// CHANGES:
// - Extended BetsService constructor to accept a SolutionsRepo.
// - In getBetBundles, loaded all solutions for the bet's questions via SolutionsRepo.
// - Enriched each question DTO with `solutions: [...]`, supporting multiple solutions per question,
//   and resolving list-type solutions to labels/country/team using the existing list_items metadata.