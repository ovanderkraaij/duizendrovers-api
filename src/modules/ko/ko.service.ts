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

        // NEW: duel meta for knockout rounds (current user + opponent)
        duel?: {
            first_answered_user_id: number | null;
            user: {
                user_id: number;
                display_name: string;
                has_submitted: boolean;
                submitted_at: string | null;
                entries: Array<{
                    question_id: number;
                    list_item_id: number | null;
                    label: string | null;
                    result: string | null;
                }>;
            };
            opponent: {
                user_id: number;
                display_name: string;
                has_submitted: boolean;
                submitted_at: string | null;
                entries: Array<{
                    question_id: number;
                    list_item_id: number | null;
                    label: string | null;
                    result: string | null;
                }>;
            } | null;
        } | null;
    };
};


export type KoSubmitPayload = {
    ko_question_id: number;
    user_id: number;
    duel_id: string | null;
    ko_list_item_id: number | null;
    label: string | null;
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
 * Dynamic label for knockout rounds based on the number of participants
 * IN THAT ROUND (derived from pairs, not global alive count).
 */
function getKnockoutRoundLabelFromParticipantCount(
    participantCount: number,
): string {
    switch (participantCount) {
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
            return `Knock-out (${participantCount})`;
    }
}

/**
 * Helper: derive the number of unique participants in a knockout round
 * from the ko_users_pair rows for that question.
 */
function getParticipantsCountFromPairs(
    pairs: Array<{ home_user_id: number | string; away_user_id: number | string }>,
): number {
    const ids = new Set<number>();
    for (const p of pairs) {
        const homeId = Number((p as any).home_user_id);
        const awayId = Number((p as any).away_user_id);
        if (Number.isFinite(homeId)) ids.add(homeId);
        if (Number.isFinite(awayId)) ids.add(awayId);
    }
    return ids.size;
}

export class KoService {
    constructor(private readonly repo: KoRepo) {}

    /**
     * Submit a KO answer for the current user.
     *
     * Rules:
     * - Voorrondes (no duel): just insert the user's answer once; no resubmits.
     * - Knockout phase (duel present):
     *   • resulttype is "list" with exactly two ko_listitem entries.
     *   • submitting user gets the chosen label.
     *   • opponent automatically gets the other label, posted = 1, answered = NULL.
     * - Once a posted answer exists for this user+question (including auto-assigned),
     *   it cannot be changed via this endpoint.
     */
    async submitKoAnswer(payload: KoSubmitPayload): Promise<void> {
        const { ko_question_id, user_id, duel_id, ko_list_item_id, label } =
            payload;

        if (!Number.isFinite(ko_question_id) || !Number.isFinite(user_id)) {
            throw new Error(
                "ko_question_id and user_id are required and must be numeric",
            );
        }

        const question = await this.repo.getQuestionById(ko_question_id);
        if (!question) {
            throw new Error("KO question not found");
        }

        const now = new Date();

        if (question.closed === "1") {
            throw new Error("KO question is closed");
        }

        if (question.deadline && new Date(question.deadline) <= now) {
            throw new Error("Deadline has passed for this KO question");
        }

        // User must participate in the KO bet and not be eliminated.
        const userKo = await this.repo.getUserKoBetRow(
            question.ko_bet_id,
            user_id,
        );
        if (!userKo) {
            throw new Error("User is not participating in this KO bet");
        }
        if (userKo.eliminated === "1") {
            console.error("[KO] Submission blocked for eliminated user", {
                user_id,
                ko_bet_id: question.ko_bet_id,
                ko_question_id: question.id,
            });
            throw new Error("User has already been eliminated from this KO bet");
        }

        // Hard guard: once a posted answer exists (manual or auto), do NOT allow changes.
        const hasPosted = await this.repo.hasPostedAnswerForUser(
            question.id,
            user_id,
        );
        if (hasPosted) {
            throw new Error(
                "User has already submitted an answer for this KO question",
            );
        }

        // Check if this question has a duel pair for the user.
        const pair = await this.repo.getPairForUser(question.id, user_id);

        if (!pair) {
            // -----------------------------------------------------------------
            // VOORRONDE: no duel → single insertion, no resubmits.
            // -----------------------------------------------------------------

            // - if ko_list_item_id is provided and list items exist, map to label.
            // - else fall back to the free-text label from payload.
            let finalLabel: string | null = null;
            let finalResult: string | null = null;

            const listItems = await this.repo.getListItemsForQuestion(
                question.id,
            );

            if (ko_list_item_id != null && listItems.length > 0) {
                const chosen = listItems.find(
                    (li) => li.id === ko_list_item_id,
                );
                if (!chosen) {
                    throw new Error(
                        "Invalid ko_list_item_id for this KO question",
                    );
                }
                finalLabel = chosen.label;
                finalResult = chosen.label;
            } else if (label && label.trim().length > 0) {
                finalLabel = label.trim();
                finalResult = finalLabel;
            } else {
                throw new Error(
                    "Either ko_list_item_id or label is required for KO submission",
                );
            }

            await this.repo.insertKoAnswer({
                ko_question_id: question.id,
                user_id,
                result: finalResult,
                label: finalLabel,
                posted: "1",
                answered: now,
            });

            return;
        }

        // ---------------------------------------------------------------------
        // KNOCKOUT PHASE: duel present.
        // ---------------------------------------------------------------------

        // For knockout phases, we expect a "list" resulttype with exactly 2 items.
        const listItems = await this.repo.getListItemsForQuestion(question.id);

        if (listItems.length !== 2) {
            throw new Error(
                "Knockout rounds must have exactly two KO list items configured",
            );
        }

        if (ko_list_item_id == null) {
            throw new Error(
                "ko_list_item_id is required for knockout KO submissions",
            );
        }

        // Validate duel_id structure and membership.
        if (!duel_id) {
            throw new Error("duel_id is required for knockout KO submissions");
        }

        const parts = duel_id.split(":");
        if (parts.length !== 3) {
            throw new Error("Invalid duel_id format");
        }

        const duelQuestionId = Number(parts[0]);
        const homeId = Number(parts[1]);
        const awayId = Number(parts[2]);

        if (
            !Number.isFinite(duelQuestionId) ||
            !Number.isFinite(homeId) ||
            !Number.isFinite(awayId) ||
            duelQuestionId !== question.id
        ) {
            throw new Error("duel_id does not match KO question");
        }

        if (user_id !== homeId && user_id !== awayId) {
            throw new Error("User is not part of the provided duel");
        }

        const chosen = listItems.find((li) => li.id === ko_list_item_id);
        if (!chosen) {
            throw new Error("Invalid ko_list_item_id for this knockout question");
        }

        const other = listItems.find((li) => li.id !== ko_list_item_id);
        if (!other) {
            throw new Error(
                "Unable to resolve the opponent KO list item for knockout question",
            );
        }

        const opponentId = user_id === homeId ? awayId : homeId;

        // Submitting user: chosen label, answered = now.
        await this.repo.insertKoAnswer({
            ko_question_id: question.id,
            user_id,
            result: chosen.label,
            label: chosen.label,
            posted: "1",
            answered: now,
        });

        // Opponent: other label, posted = 1, answered = NULL (auto-assigned, also final).
        await this.repo.insertKoAnswer({
            ko_question_id: question.id,
            user_id: opponentId,
            result: other.label,
            label: other.label,
            posted: "1",
            answered: null,
        });
    }

    /**
     * Main entry point for the FE teaser/submission:
     * - Finds the active KO bet for a season
     * - Finds the current open KO question (deadline in the future)
     * - Determines the user state (active / eliminated / not_participating)
     * - Builds a single-question payload including KO-specific flags:
     *   deadline, winnow, closed, draw, draw_date, regex
     *
     * For the round label:
     * - "Voorronde N" for middle questions (no pairs)
     * - For knockout questions, we derive the label from the number of
     *   participants in the CURRENT QUESTION'S pairs.
     */
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
        // Round index + label logic.
        // ---------------------------------------------------------------------

        const [questions, userKoRows, allPairs] = await Promise.all([
            this.repo.getQuestionsForBet(bet.id),
            this.repo.getUsersForBet(bet.id),
            this.repo.getPairsForBet(bet.id),
        ]);

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

        const phaseByQuestionId = new Map<number, "middle" | "knockout">();
        for (const q of questions) {
            const hasPairs = (pairsByQuestionId.get(q.id) ?? []).length > 0;
            phaseByQuestionId.set(q.id, hasPairs ? "knockout" : "middle");
        }

        const currentPhase = phaseByQuestionId.get(question.id) ?? "middle";

        let currentRoundLabel: string | null = null;

        if (currentPhase === "middle") {
            let middleRoundCounter = 0;

            for (const q of questions) {
                const phase = phaseByQuestionId.get(q.id) ?? "middle";
                if (phase === "middle") {
                    middleRoundCounter += 1;
                }

                if (q.id === question.id) {
                    currentRoundLabel = `Voorronde ${middleRoundCounter}`;
                    break;
                }
            }
        } else {
            const pairsForCurrent = pairsByQuestionId.get(question.id) ?? [];

            const participantCount =
                pairsForCurrent.length > 0
                    ? getParticipantsCountFromPairs(pairsForCurrent)
                    : userKoRows.filter((row) => row.eliminated === "0").length;

            currentRoundLabel =
                getKnockoutRoundLabelFromParticipantCount(participantCount);
        }

        if (!currentRoundLabel) {
            currentRoundLabel = ROUND_LABELS[bet.round ?? 0] ?? null;
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
        let pairForUser: any | null = null;

        if (userState === "active") {
            const pair = await this.repo.getPairForUser(question.id, userId);
            if (pair) {
                pairForUser = pair;
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

            deadline: toIsoOrNull(question.deadline),
            winnow: question.winnow === "1",
            closed: question.closed === "1",
            draw: Number(question.draw ?? 0) === 1,
            draw_date: toIsoOrNull(question.draw_date),
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

        // ---------------------------------------------------------------------
        // NEW: duel metadata for knockout phase (current user + opponent).
        // ---------------------------------------------------------------------
        let duelMeta: KoPayload["user_answers"]["duel"] | null = null;

        if (
            currentPhase === "knockout" &&
            userState === "active" &&
            pairForUser
        ) {
            const homeId = Number(pairForUser.home_user_id);
            const awayId = Number(pairForUser.away_user_id);
            const opponentId = userId === homeId ? awayId : homeId;

            const [opponentAnswer, displayNames] = await Promise.all([
                this.repo.getUserAnswerForQuestion(question.id, opponentId),
                this.repo.getUserDisplayNames([userId, opponentId]),
            ]);

            const getName = (id: number): string =>
                displayNames.get(id) ?? `Speler ${id}`;

            const userAnsweredAtDate = answer?.answered
                ? new Date(answer.answered)
                : null;
            const opponentAnsweredAtDate = opponentAnswer?.answered
                ? new Date(opponentAnswer.answered)
                : null;

            let firstAnsweredUserId: number | null = null;

            if (userAnsweredAtDate && opponentAnsweredAtDate) {
                if (userAnsweredAtDate < opponentAnsweredAtDate) {
                    firstAnsweredUserId = userId;
                } else if (opponentAnsweredAtDate < userAnsweredAtDate) {
                    firstAnsweredUserId = opponentId;
                } else {
                    // Same timestamp; arbitrary but stable tie-breaker.
                    firstAnsweredUserId = userId;
                }
            } else if (userAnsweredAtDate && !opponentAnsweredAtDate) {
                firstAnsweredUserId = userId;
            } else if (!userAnsweredAtDate && opponentAnsweredAtDate) {
                firstAnsweredUserId = opponentId;
            } else {
                firstAnsweredUserId = null;
            }

            let opponentListItemId: number | null = null;
            if (resultTypeDto.label === "list" && opponentAnswer?.label) {
                const li = listItems.find(
                    (item) => item.label === opponentAnswer.label,
                );
                opponentListItemId = li ? li.id : null;
            }

            duelMeta = {
                first_answered_user_id: firstAnsweredUserId,
                user: {
                    user_id: userId,
                    display_name: getName(userId),
                    has_submitted: hasSubmitted,
                    submitted_at: submittedAt,
                    entries: answerEntries,
                },
                opponent: {
                    user_id: opponentId,
                    display_name: getName(opponentId),
                    has_submitted: opponentAnswer?.posted === "1",
                    submitted_at: toIsoOrNull(
                        opponentAnswer?.answered ?? null,
                    ),
                    entries:
                        opponentAnswer != null
                            ? [
                                {
                                    question_id: question.id,
                                    list_item_id: opponentListItemId,
                                    label: opponentAnswer.label ?? null,
                                    result: opponentAnswer.result ?? null,
                                },
                            ]
                            : [],
                },
            };
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
                duel: duelMeta,
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
     *   • all pairs for knockout rounds, with first answered info
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

        // Total participants in this KO bet (e.g. 146 in your example).
        const totalParticipants = userKoRows.length;

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

// src/modules/ko/ko.service.ts

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

        // Helper: how many participants are alive AFTER this round index?
        // I.e. after applying elimination for ko_question_id at this index.
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
        // Knockout-round counter for per-phase indexing ("Achtste finale 1", "Achtste finale 2", ...).
        let knockoutRoundCounter = 0;

        const rounds: KoTournamentRound[] = await Promise.all(
            questions.map(async (q, idx) => {
                const qid = q.id;
                const label = q.label;
                const phase = phaseByQuestionId.get(qid) ?? "middle";
                const isCurrent = currentRoundId === qid;

                const aliveCount = aliveCountPerQuestionIndex[idx];

                const answersForQ = answersByQuestionId.get(qid) ?? [];
                const pairsForQ = pairsByQuestionId.get(qid) ?? [];
                const listItems = listItemsPerQuestion.get(qid) ?? [];

                // Label + per-phase index: middle vs knockout.
                let round_label: string;
                let round_index: number;

                if (phase === "middle") {
                    middleRoundCounter += 1;
                    round_index = middleRoundCounter;
                    round_label = `Voorronde ${middleRoundCounter}`;
                } else {
                    knockoutRoundCounter += 1;
                    round_index = knockoutRoundCounter;

                    const participantCount =
                        pairsForQ.length > 0
                            ? getParticipantsCountFromPairs(pairsForQ)
                            // Fallback: if pairs missing for some reason, use alive count.
                            : aliveCount;

                    round_label =
                        getKnockoutRoundLabelFromParticipantCount(
                            participantCount,
                        );
                }

                // Human-readable phase label for the UI.
                const phase_label = phase === "middle" ? "Voorrondes" : "Finales";

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

                // Number of participants eliminated in this specific round.
                const participants_eliminated = eliminatedForRound.length;

                // Solution label for this round (may be null if not set yet).
                const solution_label = await this.repo.getSolutionByQuestionId(qid);

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
                    phase_label,
                    is_current: isCurrent,
                    round_label,
                    // Index within the phase ("middle" or "knockout"), 1-based
                    round_index,
                    deadline_utc: toIsoOrNull(q.deadline),
                    opened_utc: toIsoOrNull((q as any).opened ?? null),
                    participants_total: totalParticipants,
                    participants_alive: aliveCount,
                    participants_eliminated,
                    solution_label,
                    list_items: listItems,
                    answers: {
                        entries,
                        eliminated: eliminatedForRound,
                    },
                    pairs,
                };

                return round;
            }),
        );

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