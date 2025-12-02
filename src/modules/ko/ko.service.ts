// src/modules/ko/ko.service.ts
import { KoRepo, KoTournamentPayload, KoTournamentRound } from "./ko.repo";

export type KoUserState = "active" | "eliminated" | "not_participating";

export type KoQuestionDto = {
    id: number;
    parentId: null;
    groupCode: number;
    lineup: number;
    points: number;
    block: boolean;
    virtual: null;
    margin: null;
    step: null;

    title: string;
    label: string;
    descr: string | null;

    sportId: null;
    sportLabel: null;
    leagues: any[];

    kind: "ko";
    displayPoints: null;
    match: null;

    resultType: {
        label: string;
        regex: string | null;
        info: string | null;
        placeholder: string | null;
    };

    blockChildren: any[];

    list: {
        id: number;
        meta: {
            disableOrder: boolean;
            noDoubleTeam: boolean;
            noDoubleLabel: boolean;
            showTeams: boolean;
        };
        items: Array<{
            id: number;
            label: string;
            country: null;
            team: null;
        }>;
    } | null;

    // NEW: KO-specific fields surfaced on the question
    deadline: string | null;
    winnow: boolean;
    closed: boolean;
    draw: boolean;
    draw_date: string | null;
    regex: string | null;
};

export type KoPayload = {
    bet_id: number | null;
    bet_title: string | null;
    bet_post_id: number | null;

    ko: {
        enabled: boolean;
        round_id: number | null;
        round_label: string | null;
        round_index: number | null;

        user_state: KoUserState;
        duel_id: string | null;
        is_decider: boolean;
    };

    questions: KoQuestionDto[];

    user_answers: {
        has_submitted: boolean;
        submitted_at: string | null;
        entries: Array<{
            question_id: number;
            list_item_id: number | null;
            label: string | null;
            result: string | null;
        }>;
    };
};

// Minimal round-label mapping for the UI; can be extended later if needed.
const ROUND_LABELS: Record<number, string> = {
    1: "Voorronde",
    2: "Achtste finale",
    3: "Kwartfinale",
    4: "Halve finale",
    5: "Finale",
};

function toIsoOrNull(
    dt: Date | string | null | undefined,
): string | null {
    if (!dt) return null;
    const d = dt instanceof Date ? dt : new Date(dt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

/**
 * Dynamic label for knockout rounds based on the number of alive participants.
 *
 * This is only for the knockout phase (after middle questions).
 */
function getKnockoutRoundLabelFromAliveCount(aliveCount: number): string {
    switch (aliveCount) {
        case 2:
            return "Finale";
        case 4:
            return "Halve finale";
        case 8:
            return "Kwartfinale";
        case 16:
            return "Achtste finale";
        case 32:
            return "1/16 finale";
        case 64:
            return "1/32 finale";
        case 128:
            return "1/64 finale";
        default:
            return `Knock-out (${aliveCount})`;
    }
}

export class KoService {
    constructor(private readonly repo: KoRepo) {}

    /**
     * Main entry point for the FE teaser/submission:
     * - Finds the active KO bet for a season
     * - Finds the current open KO question (deadline in the future)
     * - Determines the user state (active / eliminated / not_participating)
     * - Builds a single-question payload including KO-specific flags:
     *   deadline, winnow, closed, draw, draw_date, regex
     *
     * For the round label, we reuse the same logic as the tournament:
     * - "Voorronde N" for middle questions
     * - Knockout labels derived from the number of alive participants.
     */
// src/modules/ko/ko.service.ts
    async getCurrentForUser(
        seasonId: number,
        userId: number,
    ): Promise<KoPayload> {
        const now = new Date();

        const bet = await this.repo.getActiveBetForSeason(seasonId);
        if (!bet) {
            // No knockout running for this season.
            return {
                bet_id: null,
                bet_title: null,
                bet_post_id: null,
                ko: {
                    enabled: false,
                    round_id: null,
                    round_label: null,
                    round_index: null,
                    user_state: "not_participating",
                    duel_id: null,
                    is_decider: false,
                },
                questions: [],
                user_answers: {
                    has_submitted: false,
                    submitted_at: null,
                    entries: [],
                },
            };
        }

        const question = await this.repo.getCurrentQuestionForBet(bet.id, now);
        if (!question) {
            // KO bet exists but nothing open or with a future deadline.
            // We intentionally do NOT guess a round_index here, because that
            // depends on a concrete ko_question row (winnow + id ordering).
            return {
                bet_id: bet.id,
                bet_title: bet.label,
                bet_post_id: bet.post_id ?? null,
                ko: {
                    enabled: false,
                    round_id: bet.round ?? null,
                    round_label: ROUND_LABELS[bet.round ?? 0] ?? null,
                    round_index: null,
                    user_state: "not_participating",
                    duel_id: null,
                    is_decider: false,
                },
                questions: [],
                user_answers: {
                    has_submitted: false,
                    submitted_at: null,
                    entries: [],
                },
            };
        }

        // ---------------------------------------------------------------------
        // Round label logic shared with tournament:
        // - determine phase ("middle" vs "knockout") per question
        // - compute alive counts per round index
        // - derive label for the CURRENT question:
        //     • "Voorronde N" for middle rounds
        //     • knockout label from alive participants for knockout rounds
        // ---------------------------------------------------------------------

        const [questions, userKoRows, allPairs] = await Promise.all([
            this.repo.getQuestionsForBet(bet.id),
            this.repo.getUsersForBet(bet.id),
            this.repo.getPairsForBet(bet.id),
        ]);

        // Compute round_index based on ko_question table:
        // - group by winnow (middle vs knockout)
        // - sort by id ASC within that group
        // - 1-based index of the current question inside its winnow-group
        const roundIndex: number | null = (() => {
            const phaseFlag = question.winnow; // '0' | '1'
            const samePhaseQuestions = questions
                .filter((q) => q.winnow === phaseFlag)
                .sort((a, b) => a.id - b.id);

            const idx = samePhaseQuestions.findIndex(
                (q) => q.id === question.id,
            );
            if (idx === -1) {
                return null;
            }
            return idx + 1; // 1-based
        })();

        // If for some reason questions do not include the current one, fall back.
        const currentQuestionIndex = questions.findIndex(
            (q) => q.id === question.id,
        );

        let currentRoundLabel: string | null = null;

        if (currentQuestionIndex === -1) {
            // Safety fallback: use coarse label based on bet.round
            currentRoundLabel = ROUND_LABELS[bet.round ?? 0] ?? null;
        } else {
            // Pre-compute ordering index per question.
            const questionOrderIndex = new Map<number, number>();
            questions.forEach((q, idx) => {
                questionOrderIndex.set(q.id, idx);
            });

            // Group pairs per question for quick lookup.
            const pairsByQuestionId = new Map<number, typeof allPairs>();
            for (const pair of allPairs) {
                const qid = Number(pair.ko_question_id);
                const bucket = pairsByQuestionId.get(qid);
                if (bucket) {
                    bucket.push(pair);
                } else {
                    pairsByQuestionId.set(qid, [pair]);
                }
            }

            // Determine phase type per question: middle vs knockout.
            const phaseByQuestionId = new Map<number, "middle" | "knockout">();
            for (const q of questions) {
                const hasPairs = (pairsByQuestionId.get(q.id) ?? []).length > 0;
                phaseByQuestionId.set(q.id, hasPairs ? "knockout" : "middle");
            }

            // Map user_id -> elimination index (round index) or null if still alive.
            const userEliminationIndex = new Map<number, number | null>();
            for (const row of userKoRows) {
                const uid = Number(row.user_id);
                if (row.eliminated === "1" && row.ko_question_id != null) {
                    const elimIdx =
                        questionOrderIndex.get(Number(row.ko_question_id)) ??
                        null;
                    userEliminationIndex.set(uid, elimIdx);
                } else {
                    userEliminationIndex.set(uid, null);
                }
            }

            const getAliveCountForIndex = (roundIndex: number): number => {
                let count = 0;
                for (const row of userKoRows) {
                    const uid = Number(row.user_id);
                    const elimIdx = userEliminationIndex.get(uid);
                    if (elimIdx === null || elimIdx > roundIndex) {
                        count += 1;
                    }
                }
                return count;
            };

            // Walk questions in order to:
            // - increment middle-round counter
            // - when we hit the current question, compute its label based on phase
            let middleRoundCounter = 0;

            for (let idx = 0; idx < questions.length; idx++) {
                const q = questions[idx];
                const phase = phaseByQuestionId.get(q.id) ?? "middle";

                if (phase === "middle") {
                    middleRoundCounter += 1;
                }

                if (q.id === question.id) {
                    if (phase === "middle") {
                        currentRoundLabel = `Voorronde ${middleRoundCounter}`;
                    } else {
                        const aliveCount = getAliveCountForIndex(idx);
                        currentRoundLabel =
                            getKnockoutRoundLabelFromAliveCount(aliveCount);
                    }
                    break;
                }
            }

            // Extra guard in case something went wrong in the loop
            if (!currentRoundLabel) {
                currentRoundLabel = ROUND_LABELS[bet.round ?? 0] ?? null;
            }
        }

        // ---------------------------------------------------------------------
        // User state (active vs eliminated vs not_participating)
        // ---------------------------------------------------------------------
        const userKoBet = await this.repo.getUserKoBetRow(bet.id, userId);
        let userState: KoUserState = "not_participating";
        if (userKoBet) {
            userState = userKoBet.eliminated === "1" ? "eliminated" : "active";
        }

        // Duel info only makes sense if user is still active.
        let duelId: string | null = null;
        let isDecider = false;
        if (userState === "active") {
            const pair = await this.repo.getPairForUser(question.id, userId);
            if (pair) {
                // We don't have a dedicated duel table, so use a composite stable id.
                duelId = `${question.id}:${pair.home_user_id}:${pair.away_user_id}`;
                isDecider = true;
            }
        }

        // Resulttype meta.
        const rtMeta = question.resulttype_id
            ? await this.repo.getResultTypeMeta(question.resulttype_id)
            : null;

        const resultTypeDto = {
            label: rtMeta?.label ?? "open",
            regex: rtMeta?.regex ?? null,
            info: rtMeta?.info ?? null,
            placeholder: rtMeta?.placeholder ?? null,
        };

        // List items (if applicable). We assume ko_listitem.list_id groups items per question.
        const listItems = await this.repo.getListItemsForQuestion(question.id);
        const listDto =
            listItems.length > 0
                ? {
                    id: question.id, // logical id for this list in KO context
                    meta: {
                        disableOrder: false,
                        noDoubleTeam: false,
                        noDoubleLabel: false,
                        showTeams: false,
                    },
                    items: listItems.map((li) => ({
                        id: li.id,
                        label: li.label,
                        country: null,
                        team: null,
                    })),
                }
                : null;

        const questionDto: KoQuestionDto = {
            id: question.id,
            parentId: null,
            groupCode: 0,
            lineup: 1,
            points: 0,
            block: false,
            virtual: null,
            margin: null,
            step: null,

            title: question.label,
            label: question.label,
            descr: question.descr ?? null,

            sportId: null,
            sportLabel: null,
            leagues: [],

            kind: "ko",
            displayPoints: null,
            match: null,

            resultType: resultTypeDto,
            blockChildren: [],
            list: listDto,

            // NEW KO fields – mapped 1:1 from ko_question
            deadline: toIsoOrNull(question.deadline),
            winnow: question.winnow === "1",
            closed: question.closed === "1",
            draw: Number(question.draw ?? 0) === 1,
            draw_date: toIsoOrNull(question.draw_date),
            // Per-question regex override; fall back to resulttype regex if absent.
            regex: question.regex ?? rtMeta?.regex ?? null,
        };

        // User answer (read-only context for FE)
        const answer = await this.repo.getUserAnswerForQuestion(
            question.id,
            userId,
        );
        let hasSubmitted = false;
        let submittedAt: string | null = null;
        const answerEntries: KoPayload["user_answers"]["entries"] = [];

        if (answer) {
            hasSubmitted = answer.posted === "1";
            submittedAt = toIsoOrNull(answer.answered);

            let listItemId: number | null = null;
            if (resultTypeDto.label === "list") {
                // Best-effort: map back to ko_listitem.id by label within this question's list.
                listItemId =
                    (await this.repo.findListItemIdByLabel(
                        question.id,
                        answer.label,
                    )) ?? null;
            }

            answerEntries.push({
                question_id: question.id,
                list_item_id: listItemId,
                label: answer.label ?? null,
                result: answer.result ?? null,
            });
        }

        return {
            bet_id: bet.id,
            bet_title: bet.label,
            bet_post_id: bet.post_id ?? null,
            ko: {
                enabled: true,
                round_id: bet.round ?? null,
                round_label: currentRoundLabel,
                round_index: roundIndex,
                user_state: userState,
                duel_id: duelId,
                is_decider: isDecider,
            },
            questions: [questionDto],
            user_answers: {
                has_submitted: hasSubmitted,
                submitted_at: submittedAt,
                entries: answerEntries,
            },
        };
    }

    /**
     * Tournament entry point for the KO article page.
     *
     * - Assumes a single active+open KO bet for the season (same as getCurrentForUser).
     * - Returns the full evolution of the tournament:
     *   • all "middle" (non-paired) rounds
     *   • all "knockout" (paired) rounds
     *   • eliminated users per round
     *   • all answers per round (alphabetical)
     *   • all pairs per knockout round, with first answered info
     *
     * NOTE: This method relies on the repository to supply:
     *   - all questions for the bet
     *   - all ko_users_ko_bet rows for the bet
     *   - all answers for all questions in the bet
     *   - all pairs for all questions in the bet
     *   - display names for the involved user ids
     */
    async getTournament(seasonId: number): Promise<KoTournamentPayload> {
        const bet = await this.repo.getActiveBetForSeason(seasonId);
        if (!bet) {
            // Article page should not be requested if there is no active KO;
            // we throw here so the route can translate into 404.
            throw new Error("No active KO bet for this season");
        }

        // All questions for this KO bet, ordered chronologically.
        const questions = await this.repo.getQuestionsForBet(bet.id);
        if (!questions || questions.length === 0) {
            throw new Error("KO bet has no questions configured");
        }

        const now = new Date();

        // Identify the "current" round: first open question with future deadline.
        const currentQuestion =
            questions.find(
                (q) =>
                    q.closed === "0" &&
                    q.deadline !== null &&
                    new Date(q.deadline) > now,
            ) ?? null;
        const currentRoundId = currentQuestion ? currentQuestion.id : null;

        // Bulk-load the rest of the tournament data from the repo.
        const [userKoRows, allAnswers, allPairs] = await Promise.all([
            this.repo.getUsersForBet(bet.id),
            this.repo.getAnswersForBet(bet.id),
            this.repo.getPairsForBet(bet.id),
        ]);

        // Collect all user_ids we need display names for.
        const userIdSet = new Set<number>();
        for (const row of userKoRows) {
            userIdSet.add(Number(row.user_id));
        }
        for (const ans of allAnswers) {
            userIdSet.add(Number(ans.user_id));
        }
        for (const pair of allPairs) {
            userIdSet.add(Number(pair.home_user_id));
            userIdSet.add(Number(pair.away_user_id));
        }

        const userDisplayNameMap =
            await this.repo.getUserDisplayNames(Array.from(userIdSet));

        const getDisplayName = (userId: number): string => {
            return (
                userDisplayNameMap.get(userId) ??
                userDisplayNameMap.get(Number(userId)) ??
                `Speler ${userId}`
            );
        };

        // Pre-compute ordering index per question to reason about "before / after".
        const questionOrderIndex = new Map<number, number>();
        questions.forEach((q, idx) => {
            questionOrderIndex.set(q.id, idx);
        });

        // Map user_id -> elimination index (round index) or null if still alive.
        const userEliminationIndex = new Map<number, number | null>();
        for (const row of userKoRows) {
            const userId = Number(row.user_id);
            if (row.eliminated === "1" && row.ko_question_id != null) {
                const elimIdx =
                    questionOrderIndex.get(Number(row.ko_question_id)) ?? null;
                userEliminationIndex.set(userId, elimIdx);
            } else {
                userEliminationIndex.set(userId, null);
            }
        }

        // Group answers and pairs per question for quick lookup.
        const answersByQuestionId = new Map<number, typeof allAnswers>();
        for (const ans of allAnswers) {
            const qid = Number(ans.ko_question_id);
            const bucket = answersByQuestionId.get(qid);
            if (bucket) {
                bucket.push(ans);
            } else {
                answersByQuestionId.set(qid, [ans]);
            }
        }

        const pairsByQuestionId = new Map<number, typeof allPairs>();
        for (const pair of allPairs) {
            const qid = Number(pair.ko_question_id);
            const bucket = pairsByQuestionId.get(qid);
            if (bucket) {
                bucket.push(pair);
            } else {
                pairsByQuestionId.set(qid, [pair]);
            }
        }

        // Preload list items for all questions (one list per question).
        const listItemsPerQuestion = new Map<
            number,
            { id: number; label: string }[]
            >();
        const listPromises = questions.map(async (q) => {
            const items = await this.repo.getListItemsForQuestion(q.id);
            listItemsPerQuestion.set(
                q.id,
                items.map((li) => ({ id: li.id, label: li.label })),
            );
        });
        await Promise.all(listPromises);

        // Determine phase type per question: middle vs knockout.
        // Heuristic:
        //   - if there are ko_users_pair rows for that question -> knockout
        //   - otherwise -> middle
        const phaseByQuestionId = new Map<number, "middle" | "knockout">();
        for (const q of questions) {
            const hasPairs = (pairsByQuestionId.get(q.id) ?? []).length > 0;
            phaseByQuestionId.set(q.id, hasPairs ? "knockout" : "middle");
        }

        // Helper: how many participants are alive BEFORE this question (round index)?
        const getAliveCountForIndex = (roundIndex: number): number => {
            let count = 0;
            for (const row of userKoRows) {
                const userId = Number(row.user_id);
                const elimIndex = userEliminationIndex.get(userId);
                // Alive if not eliminated at all, or eliminated strictly AFTER this round.
                if (elimIndex === null || elimIndex > roundIndex) {
                    count += 1;
                }
            }
            return count;
        };

        // Pre-compute alive counts per question index.
        const aliveCountPerQuestionIndex: number[] = questions.map((_, idx) =>
            getAliveCountForIndex(idx),
        );

        // Middle-round counter for labels ("Voorronde 1", "Voorronde 2", ...).
        let middleRoundCounter = 0;

        const rounds: KoTournamentRound[] = questions.map((q, idx) => {
            const qid = q.id;
            const label = q.label;
            const phase = phaseByQuestionId.get(qid) ?? "middle";
            const isCurrent = currentRoundId === qid;

            const aliveCount = aliveCountPerQuestionIndex[idx];

            // Label: middle vs knockout naming.
            let round_label: string;
            if (phase === "middle") {
                middleRoundCounter += 1;
                round_label = `Voorronde ${middleRoundCounter}`;
            } else {
                round_label = getKnockoutRoundLabelFromAliveCount(aliveCount);
            }

            const answersForQ = answersByQuestionId.get(qid) ?? [];
            const pairsForQ = pairsByQuestionId.get(qid) ?? [];
            const listItems = listItemsPerQuestion.get(qid) ?? [];

            // Build entries (alphabetical by display_name).
            const entries = answersForQ.map((ans) => {
                const userId = Number(ans.user_id);
                const displayName = getDisplayName(userId);
                const elimIdx = userEliminationIndex.get(userId);
                const eliminatedHere =
                    elimIdx != null && elimIdx === questionOrderIndex.get(qid);

                return {
                    user_id: userId,
                    display_name: displayName,
                    label: ans.label ?? null,
                    result: ans.result ?? null,
                    answered_at_utc: toIsoOrNull(ans.answered),
                    eliminated_here: eliminatedHere,
                };
            });

            entries.sort((a, b) =>
                a.display_name.localeCompare(b.display_name, "nl"),
            );

            // Eliminated users for this round: derived from ko_users_ko_bet.
            const eliminatedForRound = userKoRows
                .filter((row) => {
                    if (row.eliminated !== "1" || row.ko_question_id == null) {
                        return false;
                    }
                    const elimIdx =
                        questionOrderIndex.get(Number(row.ko_question_id)) ??
                        null;
                    return elimIdx != null && elimIdx === idx;
                })
                .map((row) => {
                    const userId = Number(row.user_id);
                    const displayName = getDisplayName(userId);
                    const ans = answersForQ.find(
                        (a) => Number(a.user_id) === userId,
                    );
                    return {
                        user_id: userId,
                        display_name: displayName,
                        answer_label: ans?.label ?? null,
                    };
                })
                .sort((a, b) =>
                    a.display_name.localeCompare(b.display_name, "nl"),
                );

            // Build pairs for knockout rounds.
            const pairs =
                phase === "knockout"
                    ? pairsForQ.map((pair) => {
                        const homeId = Number(pair.home_user_id);
                        const awayId = Number(pair.away_user_id);

                        const homeAnswer = answersForQ.find(
                            (a) => Number(a.user_id) === homeId,
                        );
                        const awayAnswer = answersForQ.find(
                            (a) => Number(a.user_id) === awayId,
                        );

                        const homeAnsweredAt =
                            homeAnswer && homeAnswer.answered
                                ? new Date(homeAnswer.answered)
                                : null;
                        const awayAnsweredAt =
                            awayAnswer && awayAnswer.answered
                                ? new Date(awayAnswer.answered)
                                : null;

                        let firstAnsweredUserId: number | null = null;
                        let bothSubmitted = false;

                        if (homeAnsweredAt && awayAnsweredAt) {
                            bothSubmitted = true;
                            if (homeAnsweredAt < awayAnsweredAt) {
                                firstAnsweredUserId = homeId;
                            } else if (awayAnsweredAt < homeAnsweredAt) {
                                firstAnsweredUserId = awayId;
                            } else {
                                // Same timestamp; arbitrary but stable tie-breaker.
                                firstAnsweredUserId = homeId;
                            }
                        } else if (homeAnsweredAt && !awayAnsweredAt) {
                            firstAnsweredUserId = homeId;
                        } else if (!homeAnsweredAt && awayAnsweredAt) {
                            firstAnsweredUserId = awayId;
                        } else {
                            firstAnsweredUserId = null;
                        }

                        return {
                            home: {
                                user_id: homeId,
                                display_name: getDisplayName(homeId),
                                label: homeAnswer?.label ?? null,
                                result: homeAnswer?.result ?? null,
                                answered_at_utc: toIsoOrNull(
                                    homeAnswer?.answered ?? null,
                                ),
                            },
                            away: {
                                user_id: awayId,
                                display_name: getDisplayName(awayId),
                                label: awayAnswer?.label ?? null,
                                result: awayAnswer?.result ?? null,
                                answered_at_utc: toIsoOrNull(
                                    awayAnswer?.answered ?? null,
                                ),
                            },
                            first_answered_user_id: firstAnsweredUserId,
                            both_submitted: bothSubmitted,
                        };
                    })
                    : [];

            const round: KoTournamentRound = {
                question_id: qid,
                label,
                phase,
                is_current: isCurrent,
                round_label,
                deadline_utc: toIsoOrNull(q.deadline),
                opened_utc: toIsoOrNull((q as any).opened ?? null),
                participants_total: aliveCount,
                participants_alive: aliveCount,
                list_items: listItems,
                answers: {
                    entries,
                    eliminated: eliminatedForRound,
                },
                pairs,
            };

            return round;
        });

        const currentPhase: "middle" | "knockout" | null =
            currentRoundId != null
                ? phaseByQuestionId.get(currentRoundId) ?? null
                : null;

        return {
            bet: {
                id: bet.id,
                season_id: bet.season_id,
                label: bet.label,
                post_id: bet.post_id,
            },
            tournament: {
                current_round_id: currentRoundId,
                current_phase: currentPhase,
                rounds,
            },
        };
    }
}