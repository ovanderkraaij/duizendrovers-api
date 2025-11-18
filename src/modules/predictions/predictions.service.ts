// src/modules/predictions/predictions.service.ts
import {BetsService} from "../bets/bets.service";
import {AnswersRepo} from "../answers/answers.repo";
import {SolutionsRepo} from "../solutions/solutions.repo";
import * as classSvc from "../classification/classification.service";
import * as squadsRepo from "../squads/squads.repo";
import {PredictionsRepo} from "./predictions.repo";
import {userDisplayName} from "../../data/lookups";
import {pool} from "../../db";
import {BetsRepo} from "../bets/bets.repo";

// normalizers / display helpers
import {
    decimalsFromStep,
    displayFromMCM,
    displayFromTimeSeconds,
    formatLabelComma,
} from "../../utils/normalize";

export type ComposeArgs = {
    betId: number;
    groupCode: number;
    userId: number; // “you” (for non-margin answers_for_you)
};

type ModeParticipantHeader = {
    actual: number;
    virtual: 0 | 1;
    eliminated: 0 | 1; // derived; not DB column usage
    has_potential: 0 | 1;
    has_actual: 0 | 1;
};

type ModeLine = {
    question_id: number;
    label: string;
    list_item_id: number | null;
    gray: 0 | 1;
    potential: number;
    actual: number;
    has_potential: 0 | 1;
    has_actual: 0 | 1;
    squad_potential?: number;
    squad_actual?: number;
    squad_dropped?: 0 | 1;
};

type BundleModeMap = Record<string, { actual: number; potential: number }>;

type LineModeMap = Record<string, { actual: number; potential: number }>;

type PublicBundle = {
    eliminated: 0 | 1;
    gray: 0 | 1;
    virtual: 0 | 1;
    modes: BundleModeMap;
};

type PublicLine = {
    question_id: number;
    label: string;
    list_item_id: number | null;
    gray: 0 | 1;
    modes: LineModeMap;
};

type PublicParticipant = {
    user: { id: number; display_name: string };
    bundle: PublicBundle;
    lines: PublicLine[];
};

interface PRow {
    user: { id: number; display_name: string };
    header: ModeParticipantHeader; // score league header
    lines: ModeLine[];             // score league lines
    _flags: { mainCorrect: boolean; bonusBundleCorrect: boolean };
    _sums: { potential: number; actual: number }; // score league bundle sums
    _mainResult?: string | null; // canonical main.result (center)
}

export class PredictionsService {
    constructor(
        private bets: BetsService,
        private answers: AnswersRepo,
        private solutions: SolutionsRepo,
        private repo: PredictionsRepo
    ) {
    }

    async composeBundle(args: ComposeArgs) {
        const {betId, groupCode, userId} = args;

        // 1) Load questions
        const qDto = await this.bets.getBetQuestions(betId);

        // Group by group_code and pick neighbors
        const byGroup = new Map<number, any[]>();
        for (const q of qDto.questions) {
            const g = Number(q.groupCode ?? 0);
            if (!byGroup.has(g)) byGroup.set(g, []);
            byGroup.get(g)!.push(q);
        }
        const allGroupsSorted = [...byGroup.keys()].sort((a, b) => a - b);
        if (!byGroup.has(groupCode)) throw new Error(`Unknown group_code ${groupCode} for bet ${betId}`);

        const gIdx = allGroupsSorted.indexOf(groupCode);
        const prevGroup = allGroupsSorted[(gIdx - 1 + allGroupsSorted.length) % allGroupsSorted.length];
        const nextGroup = allGroupsSorted[(gIdx + 1) % allGroupsSorted.length];
        const bundleIndex = gIdx + 1; // 1-based
        const bundleTotal = allGroupsSorted.length;

        const questions = byGroup.get(groupCode)!.slice().sort((a, b) => (a.lineup ?? 0) - (b.lineup ?? 0));

        // Identify main, bonuses
        const mains = questions.filter((q) => !q.parentId || q.points > 0);
        const main = mains.sort((a, b) => (a.lineup ?? 0) - (b.lineup ?? 0))[0] ?? questions[0];
        const mainId = Number(main.id);
        const mainIsVirtual = Number(main.virtual ?? 0) === 1;
        const hasBonuses = questions.some((q) => q.id !== main.id && (q.points ?? 0) > 0);
        const bonusQids: number[] = hasBonuses
            ? questions.filter((q) => q.id !== main.id && (q.points ?? 0) > 0).map((q) => Number(q.id))
            : [];

        // First bonus (displayPoints > 0)
        const firstBonus = hasBonuses
            ? questions.find((q) => q.id !== main.id && (q.points ?? 0) > 0 && Number(q.displayPoints ?? 0) > 0)
            : null;
        const firstBonusId = firstBonus ? Number(firstBonus.id) : null;

        const qids = questions.map((q) => Number(q.id));

        // 2) Answers (posted) joined with users (now includes canonical `result`)
        const rows = await this.repo.getAnswersForBundle(qids);

        // 3) Build participants in memory (score league base)
        const byUser = new Map<number, PRow>();

        for (const r of rows) {
            const uid = Number(r.user_id);
            if (!byUser.has(uid)) {
                const display_name = userDisplayName({
                    id: uid,
                    firstname: r.firstname ?? null,
                    infix: r.infix ?? null,
                    lastname: r.lastname ?? null,
                } as any);
                byUser.set(uid, {
                    user: {id: uid, display_name},
                    header: {
                        actual: 0,
                        virtual: (mainIsVirtual ? 1 : 0) as 0 | 1,
                        eliminated: 0,
                        has_potential: 0,
                        has_actual: 0,
                    },
                    lines: [],
                    _flags: {mainCorrect: false, bonusBundleCorrect: false},
                    _sums: {potential: 0, actual: 0},
                });
            }
            const row = byUser.get(uid)!;
            const potential = Number(r.value ?? 0);
            const actual = Number(r.actual ?? 0);
            const line: ModeLine = {
                question_id: Number(r.question_id),
                label: String(r.label ?? ""),
                list_item_id: r.listitem_id != null ? Number(r.listitem_id) : null,
                gray: String(r.gray ?? "") === "1" ? 1 : 0,
                potential,
                actual,
                has_potential: potential > 0 ? 1 : 0,
                has_actual: actual > 0 ? 1 : 0,
            };
            row.lines.push(line);
            row._sums.potential += line.potential;
            row._sums.actual += line.actual;

            if (Number(r.question_id) === mainId) {
                if (String(r.correct ?? "") === "1") row._flags.mainCorrect = true;
                row._mainResult = r.result != null ? String(r.result) : null; // posted center
            }
            if (hasBonuses && Number(r.question_id) !== mainId && String(r.correct ?? "") === "1") {
                row._flags.bonusBundleCorrect = true;
            }
        }

        // 3b) Presentation gray propagation (bundle-level, on lines only)
        for (const p of byUser.values()) {
            // Order lines by question lineup
            p.lines.sort((a, b) => {
                const la = questions.find((q) => Number(q.id) === a.question_id)?.lineup ?? 0;
                const lb = questions.find((q) => Number(q.id) === b.question_id)?.lineup ?? 0;
                return la - lb;
            });

            const mainLine = p.lines.find((l) => l.question_id === mainId);
            if (!mainLine) continue;

            if (mainLine.gray === 1) {
                // main gray → whole bundle gray (on lines)
                for (const l of p.lines) l.gray = 1;
            } else if (hasBonuses) {
                // any bonus gray → only bonus lines gray
                const anyBonusGray = p.lines.some((l) => bonusQids.includes(l.question_id) && l.gray === 1);
                if (anyBonusGray) {
                    for (const l of p.lines) {
                        if (bonusQids.includes(l.question_id)) l.gray = 1;
                    }
                }
            }
        }

        // 3c) Derived “eliminated” + header flags based on main + solution
        const solRows = await this.solutions.getSolutionsForQids([mainId]);
        const hasMainSolution = Array.isArray(solRows) && solRows.length > 0;

        // NOTE: canonicalize main solution to avoid "02:04:33" vs seconds mismatch
        const rtInfo = await this.solutions.getResulttypesForQids([mainId]);
        const mainRt = (rtInfo?.[0]?.rt_label ?? "").toString().toLowerCase();
        let mainSolutionResult: string | null =
            hasMainSolution ? canonicalizeMarginValue(mainRt, solRows[0].result) : null;

        for (const p of byUser.values()) {
            // aggregate score-league actual
            p.header.actual = round2(p._sums.actual);

            const mainLine = p.lines.find((l) => l.question_id === mainId);
            const mainIsGray = mainLine ? (mainLine.gray === 1) : false;
            const hasActualScore = p._sums.actual > 0;
            const hasPotentialScore = p._sums.potential > 0;

            // Default flags
            p.header.has_actual = hasActualScore ? 1 : 0;
            p.header.has_potential = hasPotentialScore ? 1 : 0;

            if (!hasMainSolution) {
                // Case C: no solution at all → only gray on main matters
                p.header.eliminated = mainIsGray ? 1 : 0;
                p.header.has_actual = 0;
                p.header.has_potential = !p.header.eliminated && hasPotentialScore ? 1 : 0;
            } else if (!mainIsVirtual) {
                // Case A: final (main not virtual, solution is final)
                p.header.eliminated = p._flags.mainCorrect ? 0 : 1;
                p.header.has_actual = p.header.actual > 0 ? 1 : 0;
                // final bundles conceptually have no "potential", only final scores
                p.header.has_potential = 0;
            } else {
                // Case B: virtual (main virtual, solution is virtual)
                if (p._flags.mainCorrect) {
                    // Group 1: virtual score group (solution overrules gray)
                    p.header.eliminated = 0;
                    p.header.has_actual = p.header.actual > 0 ? 1 : 0;
                    p.header.has_potential = 1;
                } else if (!mainIsGray) {
                    // Group 2: no score yet, but still structurally possible
                    p.header.eliminated = 0;
                    p.header.has_actual = 0;
                    p.header.has_potential = hasPotentialScore ? 1 : 0;
                } else {
                    // Group 3: impossible (gray on main, no score and no potential)
                    p.header.eliminated = 1;
                    p.header.has_actual = 0;
                    p.header.has_potential = 0;
                }
            }
        }

        // 4) ORDER (fixed): actual desc, potential desc, name asc (score league)
        const participantsInternal: PRow[] = [...byUser.values()];
        participantsInternal.sort((a, b) => {
            if (b._sums.actual !== a._sums.actual) return b._sums.actual - a._sums.actual;
            if (b._sums.potential !== a._sums.potential) return b._sums.potential - a._sums.potential;
            return a.user.display_name.localeCompare(b.user.display_name, "nl", {sensitivity: "base"});
        });

        // Current open season id
        const seasonId = (await squadsRepo.getOpenSeasonId()) ?? 0;

        // 5) MODES METADATA (leagues 1..10 + squads)
        const league1 = (Array.isArray(main.leagues) ? main.leagues : []).find((l: any) => Number(l?.id) === 1);
        const scoreIconFilename =
            (league1?.icon && String(league1.icon).trim()) ? String(league1.icon).trim() : "league_star.png";
        const scoreLabel = (league1?.label && String(league1.label).trim()) ? String(league1.label).trim() : "Score";

        const modeItems: Array<{
            key: string;
            label: string;
            icon_url: string;
            type: "score" | "points" | "squads";
            sequence: number;
            virtual: 0 | 1;
        }> = [];

        // league:1
        const league1Sequence = (await classSvc.current(seasonId, 1, mainIsVirtual)).sequence ?? 0;
        modeItems.push({
            key: "league:1",
            label: scoreLabel,
            icon_url: scoreIconFilename, // raw filename; FE resolves to URL
            type: "score",
            sequence: league1Sequence,
            virtual: (mainIsVirtual ? 1 : 0) as 0 | 1,
        });

        // Points leagues (2..10 attached to MAIN)
        const mainLeagues: { id: number; label: string; icon: string }[] =
            (Array.isArray(main.leagues) ? main.leagues : [])
                .map((x: any) => ({
                    id: Number(x?.id ?? 0),
                    label: String(x?.label ?? ""),
                    icon: String(x?.icon ?? ""),
                }))
                .filter((x) => Number.isFinite(x.id) && x.id >= 2 && x.id <= 10);

        for (const l of mainLeagues) {
            const seq = (await classSvc.current(seasonId, l.id, mainIsVirtual)).sequence ?? 0;
            modeItems.push({
                key: `league:${l.id}`,
                label: l.label,
                icon_url: l.icon,
                type: "points",
                sequence: seq,
                virtual: (mainIsVirtual ? 1 : 0) as 0 | 1,
            });
        }

        // Squads mode (always included)
        const squadsSequence = league1Sequence; // sequence for squads = same as score league
        modeItems.push({
            key: "squads",
            label: "Teams",
            icon_url: "squads.png",
            type: "squads",
            sequence: squadsSequence,
            virtual: (mainIsVirtual ? 1 : 0) as 0 | 1,
        });

        // 6) PREPARE PER-MODE CONTAINERS FOR NON-MARGIN
        const bundleModesByUser = new Map<number, BundleModeMap>();
        const lineModesByUser = new Map<number, Map<number, LineModeMap>>();

        for (const p of participantsInternal) {
            const uid = p.user.id;
            bundleModesByUser.set(uid, {});
            const perQ = new Map<number, LineModeMap>();
            for (const l of p.lines) {
                perQ.set(l.question_id, {});
            }
            lineModesByUser.set(uid, perQ);
        }

        // league:1 = score league base
        for (const p of participantsInternal) {
            const uid = p.user.id;
            const bundleModes = bundleModesByUser.get(uid)!;
            const perQ = lineModesByUser.get(uid)!;

            bundleModes["league:1"] = {
                actual: round2(p._sums.actual),
                potential: round2(p._sums.potential),
            };

            for (const l of p.lines) {
                const lm = perQ.get(l.question_id)!;
                lm["league:1"] = {
                    actual: round2(l.actual),
                    potential: round2(l.potential),
                };
            }
        }

        // 7) POINTS LEAGUES (2..10) — populate per-mode maps, no separate arrays
        for (const l of mainLeagues) {
            const leagueId = l.id;
            const key = `league:${leagueId}`;

            for (const p of participantsInternal) {
                const uid = p.user.id;
                const bundleModes = bundleModesByUser.get(uid)!;
                const perQ = lineModesByUser.get(uid)!;

                // ACTUALS (gated):
                const mainActual = p._flags.mainCorrect ? 1 : 0;
                const bonusActual =
                    firstBonusId != null && hasBonuses && p._flags.mainCorrect && p._flags.bonusBundleCorrect ? 1 : 0;
                const actual = mainActual + bonusActual;

                // POTENTIALS (structural, independent of correctness/gray):
                const mainPotential = 1;
                const bonusPotential = firstBonusId != null ? 1 : 0;
                const potential = mainPotential + bonusPotential;

                bundleModes[key] = {
                    actual,
                    potential,
                };

                for (const l0 of p.lines) {
                    const isMain = l0.question_id === mainId;
                    const isFirstBonus = firstBonusId != null && l0.question_id === firstBonusId;

                    const linePotential = isMain ? 1 : isFirstBonus ? 1 : 0;
                    const lineActual = isMain ? mainActual : isFirstBonus ? bonusActual : 0;

                    const lm = perQ.get(l0.question_id)!;
                    lm[key] = {
                        actual: lineActual,
                        potential: linePotential,
                    };
                }
            }
        }

        // 8) SQUADS — populate "squads" mode for bundle + lines
        const membersData = await squadsRepo.getSeasonSquadMembers(seasonId);
        const smallest = membersData.smallest;

        // Map user -> { squadId, isCaptain }
        const memberOf = new Map<number, { squadId: number; isCaptain: boolean }>();
        for (const [sId, mems] of membersData.bySquad.entries()) {
            for (const m of mems) memberOf.set(m.user_id, {squadId: sId, isCaptain: m.is_captain});
        }

        const bySquadUser = new Map<number,
            { users: Map<number, { cap: boolean; perQActual: Map<number, number>; perQPotential: Map<number, number> }> }>();

        for (const p of participantsInternal) {
            const m = memberOf.get(p.user.id);
            if (!m) continue;
            if (!bySquadUser.has(m.squadId)) {
                bySquadUser.set(m.squadId, {users: new Map()});
            }
            const users = bySquadUser.get(m.squadId)!.users;
            const entry = {
                cap: m.isCaptain,
                perQActual: new Map<number, number>(),
                perQPotential: new Map<number, number>(),
            };
            for (const l of p.lines) {
                const a = Number(l.actual || 0) * (m.isCaptain ? 2 : 1);
                const v = Number(l.potential || 0) * (m.isCaptain ? 2 : 1);
                entry.perQActual.set(l.question_id, a);
                entry.perQPotential.set(l.question_id, v);
            }
            users.set(p.user.id, entry);
        }

        const appliedActualByUser = new Map<number, number>();
        const appliedPotentialByUser = new Map<number, number>();
        const perUserTotalActual = new Map<number, number>();
        const droppedByUserQid = new Map<number, Set<number>>();

        // NOTE: kept for possible future use; margin_view now uses a value-level
        // computation based directly on answer.score/points (see below).
        const squadsMainActualByUser = new Map<number, number>();
        const squadsMainPotentialByUser = new Map<number, number>();

        for (const [, data] of bySquadUser.entries()) {
            const users = [...data.users.entries()];
            const k = users.length;
            const factor = k > 0 && smallest > 0 ? smallest / k : 1;

            const qset = new Set<number>();
            for (const [, u] of users) {
                u.perQActual.forEach((_v, qid) => qset.add(qid));
                u.perQPotential.forEach((_v, qid) => qset.add(qid));
            }

            // pre-drop totals
            for (const [userId, u] of users) {
                let totA = 0;
                for (const qid of qset) {
                    totA += u.perQActual.get(qid) ?? 0;
                }
                perUserTotalActual.set(userId, round2(totA));
            }

            // drop worst per question by ACTUAL, apply normalization to survivors
            for (const qid of qset) {
                const vals = users.map(([uid, u]) => ({
                    uid,
                    vA: u.perQActual.get(qid) ?? 0,
                    vP: u.perQPotential.get(qid) ?? 0,
                }));
                if (vals.length >= 2) {
                    vals.sort((a, b) => a.vA - b.vA);
                    const droppedUid = vals[0]?.uid;

                    if (typeof droppedUid === "number") {
                        if (!droppedByUserQid.has(droppedUid)) droppedByUserQid.set(droppedUid, new Set());
                        droppedByUserQid.get(droppedUid)!.add(qid);
                    }

                    for (const it of vals) {
                        const contribActual = it.uid === droppedUid ? 0 : it.vA * factor;
                        const contribPotential = it.uid === droppedUid ? 0 : it.vP * factor;

                        // record per-question squads contribution for the MAIN question
                        if (qid === mainId) {
                            squadsMainActualByUser.set(
                                it.uid,
                                round2((squadsMainActualByUser.get(it.uid) ?? 0) + contribActual)
                            );
                            squadsMainPotentialByUser.set(
                                it.uid,
                                round2((squadsMainPotentialByUser.get(it.uid) ?? 0) + contribPotential)
                            );
                        }

                        if (it.uid === droppedUid) continue;

                        appliedActualByUser.set(
                            it.uid,
                            round2((appliedActualByUser.get(it.uid) ?? 0) + contribActual)
                        );
                        appliedPotentialByUser.set(
                            it.uid,
                            round2((appliedPotentialByUser.get(it.uid) ?? 0) + contribPotential)
                        );
                    }
                } else if (vals.length === 1) {
                    const it = vals[0];
                    const contribActual = it.vA * factor;
                    const contribPotential = it.vP * factor;

                    if (qid === mainId) {
                        squadsMainActualByUser.set(
                            it.uid,
                            round2((squadsMainActualByUser.get(it.uid) ?? 0) + contribActual)
                        );
                        squadsMainPotentialByUser.set(
                            it.uid,
                            round2((squadsMainPotentialByUser.get(it.uid) ?? 0) + contribPotential)
                        );
                    }

                    appliedActualByUser.set(
                        it.uid,
                        round2((appliedActualByUser.get(it.uid) ?? 0) + contribActual)
                    );
                    appliedPotentialByUser.set(
                        it.uid,
                        round2((appliedPotentialByUser.get(it.uid) ?? 0) + contribPotential)
                    );
                }
            }
        }

        // write squads mode into bundleModesByUser and lineModesByUser
        for (const p of participantsInternal) {
            const uid = p.user.id;
            const bundleModes = bundleModesByUser.get(uid)!;
            const perQ = lineModesByUser.get(uid)!;

            const appliedA = appliedActualByUser.get(uid) ?? 0;
            const appliedP = appliedPotentialByUser.get(uid) ?? 0;

            bundleModes["squads"] = {
                actual: round2(appliedA),
                potential: round2(appliedP),
            };

            const mem = memberOf.get(uid);
            const squadSize = mem ? (membersData.bySquad.get(mem.squadId)?.length ?? 0) : 0;
            const norm = squadSize > 0 && smallest > 0 ? smallest / squadSize : 1;
            const droppedSet = droppedByUserQid.get(uid) ?? new Set<number>();
            const isCaptain = mem?.isCaptain ?? false;

            for (const l of p.lines) {
                const doubledA = (l.actual || 0) * (isCaptain ? 2 : 1);
                const doubledP = (l.potential || 0) * (isCaptain ? 2 : 1);
                const dropped = droppedSet.has(l.question_id);
                const lm = perQ.get(l.question_id)!;
                lm["squads"] = {
                    actual: dropped ? 0 : round2(doubledA * norm),
                    potential: dropped ? 0 : round2(doubledP * norm),
                };
            }
        }

        // 9) “You” (answers) + solutions (multi-per-qid)
        const postedYou = await this.answers.getPostedForBetUser(betId, userId);
        const answersByQid: Record<string, any> = {};
        for (const r of postedYou as any[]) {
            if (!qids.includes(Number(r.questionId))) continue;
            answersByQid[String(r.questionId)] = {
                label: String(r.label ?? ""),
                list_item_id: r.listItemId != null ? Number(r.listItemId) : null,
                posted: true,
                result: r.result != null ? String(r.result) : null,
            };
        }
        const solRowsAll = await this.solutions.getSolutionsForQids(qids);
        const solutionsByQid: Record<string, any[]> = {};
        for (const s of solRowsAll as any[]) {
            const k = String(Number(s.question_id));
            if (!solutionsByQid[k]) solutionsByQid[k] = [];
            solutionsByQid[k].push({
                result: s.result != null ? String(s.result) : null,
                list_item_id: s.listitem_id != null ? Number(s.listitem_id) : null,
            });
        }

        // 10) MARGIN VIEW — detect bundle type
        const isMarginType = (v: string) =>
            v === "number" || v === "time" || v === "mcm" || v === "decimal";

        const mainMargin: number = Number(main.margin ?? 0);
        const mainStep: number = Number(main.step ?? 0);
        const isMarginBundle = mainMargin > 0 && mainStep && isMarginType(mainRt);

        let margin_view: any = null;

        if (isMarginBundle) {
            // Use ALL answers for main (posted + unposted variants) within this bet
            const allAns = await this.solutions.getAllAnswersForQidsInBet(betId, [mainId]);

            // Precompute per-result base for league:1 from answer.points / answer.score.
            // All users with the same prediction share the same points/score for this question.
            const league1ByValue = new Map<string, { points: number; score: number }>();
            for (const a of allAns as any[]) {
                const canon = String(a.result ?? "").trim();
                if (!canon || league1ByValue.has(canon)) continue;

                const points = Number(a.answer_points ?? 0) || 0;
                const score = Number(a.answer_score ?? 0) || 0;

                league1ByValue.set(canon, {points, score});
            }

            // Distinct canonical values across ALL rows (answers are already canonical;
            // we no longer merge different textual forms like "02:04:34" → 7474 here)
            const valueSet = new Set<string>();
            const valueStats = new Map<string, {
                hasAny: boolean;
                anyGray: boolean;
                anyNonGray: boolean;
                hasNonGrayQualified: boolean;
            }>();

            // Meta per user from score-league header (used only for POSSIBLE, not gray)
            const metaByUser = new Map<number, { name: string; eliminated: 0 | 1 }>();
            for (const p of participantsInternal) {
                metaByUser.set(p.user.id, {
                    name: p.user.display_name,
                    eliminated: p.header.eliminated,
                });
            }

            // Per-value, per-user raw scores from DB (answer.score / answer.points)
            const scoresByValueUser = new Map<string, Map<number, { actual: number; potential: number }>>();

            for (const a of allAns as any[]) {
                const canon = String(a.result ?? "").trim();
                if (!canon) continue;

                valueSet.add(canon);

                let stats = valueStats.get(canon);
                if (!stats) {
                    stats = {
                        hasAny: false,
                        anyGray: false,
                        anyNonGray: false,
                        hasNonGrayQualified: false,
                    };
                    valueStats.set(canon, stats);
                }
                stats.hasAny = true;

                const rowGray = String(a.gray ?? "0") === "1";
                const uid = Number(a.user_id);
                const meta = metaByUser.get(uid);
                const eliminated = meta?.eliminated === 1;

                if (rowGray) {
                    stats.anyGray = true;
                } else {
                    stats.anyNonGray = true;
                }

                if (!rowGray && !eliminated) {
                    stats.hasNonGrayQualified = true;
                }

                // collect score + points per (value, user)
                let perUser = scoresByValueUser.get(canon);
                if (!perUser) {
                    perUser = new Map<number, { actual: number; potential: number }>();
                    scoresByValueUser.set(canon, perUser);
                }
                const curr = perUser.get(uid) ?? {actual: 0, potential: 0};
                const addActual = Number(a.answer_score ?? 0) || 0;
                const addPotential = Number(a.answer_points ?? 0) || 0;
                curr.actual += addActual;
                curr.potential += addPotential;
                perUser.set(uid, curr);
            }

            // ensure solution is present even if nobody has that value
            if (mainSolutionResult && !valueSet.has(mainSolutionResult)) {
                valueSet.add(mainSolutionResult);
                if (!valueStats.has(mainSolutionResult)) {
                    valueStats.set(mainSolutionResult, {
                        hasAny: false,
                        anyGray: false,
                        anyNonGray: false,
                        hasNonGrayQualified: false,
                    });
                }
            }

            // Sort values numerically depending on resulttype (already canonical)
            const values = [...valueSet];
            const stepDecimals =
                mainRt === "number" || mainRt === "decimal" ? decimalsFromStep(mainStep) : 0;

            const keyToSortNumber = (canon: string): number => {
                if (mainRt === "time") return Number.parseInt(canon, 10) || 0; // seconds
                if (mainRt === "mcm") return Number.parseInt(canon, 10) || 0;  // centimeters (integer)
                const n = Number(canon);
                return Number.isFinite(n) ? n : 0;
            };
            values.sort((a, b) => keyToSortNumber(a) - keyToSortNumber(b));

            // Compute "possible" per value (bundle rules + gray/eliminated)
            const valuePossible = new Map<string, boolean>();
            for (const canon of values) {
                const stats = valueStats.get(canon) ?? {
                    hasAny: false,
                    anyGray: false,
                    anyNonGray: false,
                    hasNonGrayQualified: false,
                };
                let possible = false;

                if (!hasMainSolution) {
                    possible = stats.hasNonGrayQualified;
                } else if (!mainIsVirtual) {
                    possible = mainSolutionResult != null && canon === mainSolutionResult;
                } else {
                    possible = stats.hasNonGrayQualified || (mainSolutionResult != null && canon === mainSolutionResult);
                }

                valuePossible.set(canon, possible);
            }

            // Group participants by canonical value using ALL rows
            const groups: Record<
                string,
                {
                    participants: Array<{
                        id: number;
                        display_name: string;
                    }>;
                }
                > = {};

            for (const v of values) {
                groups[v] = {participants: []};
            }

            for (const a of allAns as any[]) {
                const canon = String(a.result ?? "").trim();
                if (!canon || !groups[canon]) continue;

                const uid = Number(a.user_id);
                const meta = metaByUser.get(uid);
                const name = meta?.name ?? `User ${uid}`;

                groups[canon].participants.push({
                    id: uid,
                    display_name: name,
                });
            }

            // Alphabetical order within each value group
            for (const v of values) {
                groups[v].participants.sort((a, b) =>
                    a.display_name.localeCompare(b.display_name, "nl", {sensitivity: "base"})
                );
            }

            // SQUADS FOR MARGIN VIEW, PER VALUE:
            // For each canonical value we apply the squads rules on top of
            // answer.score / answer.points for that value:
            //  - all members of a squad participate (even if they didn't predict this value),
            //    but those without an answer for this value get base=0;
            //  - double captain scores;
            //  - drop the single lowest per squad (if >=2 members);
            //  - normalize survivors by factor = smallestSquadSize / squadSize.
            //
            // The resulting normalized per-user contributions are exposed as
            // participants[*].modes.squads.actual / potential in margin_view.
            const squadsActualByValueUser = new Map<string, Map<number, number>>();
            const squadsPotentialByValueUser = new Map<string, Map<number, number>>();
            const squadsDroppedByValueUser = new Map<string, Set<number>>();

            for (const canon of values) {
                const perUserScores =
                    scoresByValueUser.get(canon) ?? new Map<number, { actual: number; potential: number }>();

                for (const [, squadMembers] of membersData.bySquad.entries()) {
                    const k = squadMembers.length;
                    if (!k) continue;

                    const factor = k > 0 && smallest > 0 ? smallest / k : 1;

                    const vals = squadMembers.map((m) => {
                        const uid = m.user_id;
                        const base = perUserScores.get(uid) ?? {actual: 0, potential: 0};
                        const vA = (base.actual || 0) * (m.is_captain ? 2 : 1);
                        const vP = (base.potential || 0) * (m.is_captain ? 2 : 1);
                        return {uid, vA, vP};
                    });

                    if (!vals.length) continue;

                    let droppedUid: number | null = null;
                    if (vals.length >= 2) {
                        vals.sort((a, b) => a.vA - b.vA);
                        droppedUid = vals[0].uid;
                    }

                    let perValueActual = squadsActualByValueUser.get(canon);
                    if (!perValueActual) {
                        perValueActual = new Map<number, number>();
                        squadsActualByValueUser.set(canon, perValueActual);
                    }
                    let perValuePotential = squadsPotentialByValueUser.get(canon);
                    if (!perValuePotential) {
                        perValuePotential = new Map<number, number>();
                        squadsPotentialByValueUser.set(canon, perValuePotential);
                    }

                    for (const it of vals) {
                        const isDropped = droppedUid !== null && it.uid === droppedUid && vals.length >= 2;
                        const contribActual = isDropped ? 0 : it.vA * factor;
                        const contribPotential = isDropped ? 0 : it.vP * factor;

                        if (isDropped) {
                            let droppedSet = squadsDroppedByValueUser.get(canon);
                            if (!droppedSet) {
                                droppedSet = new Set<number>();
                                squadsDroppedByValueUser.set(canon, droppedSet);
                            }
                            droppedSet.add(it.uid);
                        }

                        perValueActual.set(
                            it.uid,
                            round2((perValueActual.get(it.uid) ?? 0) + contribActual)
                        );
                        perValuePotential.set(
                            it.uid,
                            round2((perValuePotential.get(it.uid) ?? 0) + contribPotential)
                        );
                    }
                }
            }

            // Build value DTOs with modes + participants
            const valueDtos = values.map((canon) => {
                let label = canon;
                if (mainRt === "time") {
                    label = displayFromTimeSeconds(Number.parseInt(canon, 10) || 0);
                } else if (mainRt === "mcm") {
                    label = displayFromMCM(Number.parseInt(canon, 10) || 0);
                } else if (mainRt === "number" || mainRt === "decimal") {
                    label = formatLabelComma(Number(canon), stepDecimals);
                }

                const isSolutionValue = !!mainSolutionResult && canon === mainSolutionResult;

                const possible = valuePossible.get(canon) ?? false;
                const stats = valueStats.get(canon) ?? {
                    hasAny: false,
                    anyGray: false,
                    anyNonGray: false,
                    hasNonGrayQualified: false,
                };

                // GRAY for margin values:
                // - If there are any answers with this result:
                //      • if *all* of them are gray → chip.gray = 1
                //      • otherwise (at least one non-gray) → chip.gray = 0
                // - If there are no answers:
                //      • if this value equals the solution → chip.gray = 0
                //      • else → chip.gray = 1
                let gray: 0 | 1;
                if (stats.hasAny) {
                    gray = stats.anyGray && !stats.anyNonGray ? 1 : 0;
                } else if (isSolutionValue) {
                    gray = 0;
                } else {
                    gray = 1;
                }

                // Modes per value
                const modes: Record<string, { actual: number; potential: number }> = {};
                const participantsForValue = groups[canon].participants;

                for (const m of modeItems) {
                    if (!m.key.startsWith("league:")) continue; // leagues only, no squads at value level

                    if (m.key === "league:1") {
                        // League 1 (score league): take per-question points/score directly
                        // from the answer table (any user with this prediction).
                        const base = league1ByValue.get(canon);
                        const rawActual = base ? base.score : 0;
                        const rawPotential = base ? base.points : 0;
                        const actual = isSolutionValue ? rawActual : 0;
                        const potential = rawPotential;

                        modes[m.key] = {
                            actual: round2(actual),
                            potential: round2(potential),
                        };
                        continue;
                    }

                    // Other leagues (2..10): keep existing "best participant" logic
                    let maxActual = 0;
                    let maxPotential = 0;

                    for (const p of participantsForValue) {
                        const bundle = bundleModesByUser.get(p.id);
                        const entry = bundle ? bundle[m.key] : undefined;
                        if (!entry) continue;

                        if (entry.actual > maxActual) maxActual = entry.actual;
                        if (entry.potential > maxPotential) maxPotential = entry.potential;
                    }

                    modes[m.key] = {
                        actual: isSolutionValue ? round2(maxActual) : 0,
                        potential: round2(maxPotential),
                    };
                }

                // Participants for this value, with SQUADS taken from
                // this value's per-question squads contribution based on
                // answer.score / answer.points for this prediction.
                const perValueActual = squadsActualByValueUser.get(canon);
                const perValuePotential = squadsPotentialByValueUser.get(canon);
                const droppedSet = squadsDroppedByValueUser.get(canon);

                const participants = groups[canon].participants.map((p) => {
                    const squadsActual = perValueActual?.get(p.id) ?? 0;
                    const squadsPotential = perValuePotential?.get(p.id) ?? 0;
                    const memberMeta = memberOf.get(p.id);
                    const isCaptain = memberMeta?.isCaptain ?? false;
                    const isSquadMember = !!memberMeta;
                    const isDropped = isSquadMember ? (droppedSet?.has(p.id) ?? false) : false;

                    return {
                        id: p.id,
                        display_name: p.display_name,
                        is_captain: isCaptain,
                        modes: {
                            squads: {
                                actual: isSquadMember ? round2(squadsActual) : 0,
                                potential: isSquadMember ? round2(squadsPotential) : 0,
                                dropped: isSquadMember ? isDropped : false,
                                is_squad_member: isSquadMember,
                            },
                        },
                    };
                });

                return {
                    result: canon,
                    label,
                    is_solution: isSolutionValue,
                    possible,
                    gray,
                    modes,
                    participants,
                };
            });

            // Selected index logic (solution wins; otherwise middle)
            let selected_index = 0;
            const middle_index = Math.floor(values.length > 0 ? (values.length - 1) / 2 : 0);
            if (hasMainSolution && mainSolutionResult) {
                const idx = values.indexOf(mainSolutionResult);
                if (idx >= 0) selected_index = idx;
                else selected_index = middle_index;
            } else {
                selected_index = middle_index;
            }

            margin_view = {
                main_qid: mainId,
                has_solution: hasMainSolution && !!mainSolutionResult,
                values: valueDtos,
                selected_index,
                middle_index,
            };
        }
        // 11) Build public participants for NON-MARGIN only
        let participantsPayload: PublicParticipant[] = [];
        let answers_for_you: Record<string, any> | null = answersByQid;

        if (!isMarginBundle) {
            participantsPayload = participantsInternal.map((p) => {
                const uid = p.user.id;
                const bundleModes = bundleModesByUser.get(uid) ?? {};
                const perQ = lineModesByUser.get(uid) ?? new Map<number, LineModeMap>();

                const mainLine = p.lines.find((l) => l.question_id === mainId);
                const bundleGray: 0 | 1 = mainLine && mainLine.gray === 1 ? 1 : 0;

                const bundle: PublicBundle = {
                    eliminated: p.header.eliminated,
                    gray: bundleGray,
                    virtual: (mainIsVirtual ? 1 : 0) as 0 | 1,
                    modes: bundleModes,
                };

                const lines: PublicLine[] = p.lines.map((l) => {
                    const lm = perQ.get(l.question_id) ?? {};
                    return {
                        question_id: l.question_id,
                        label: l.label,
                        list_item_id: l.listitem_id,
                        gray: l.gray,
                        modes: lm,
                    };
                });

                return {
                    user: p.user,
                    bundle,
                    lines,
                };
            });
        } else {
            // Margin bundle: participants are driven by margin_view.values[*].participants
            participantsPayload = [];
            answers_for_you = null;
        }

        return {
            meta: {
                bet_id: qDto.betId,
                title: qDto.betTitle ?? `Bet ${qDto.betId}`,
                bundle_index: bundleIndex,
                bundle_total: bundleTotal,
                is_margin_bundle: !!isMarginBundle,
            },
            neighbors: {
                previous_group_code: prevGroup,
                next_group_code: nextGroup,
            },
            questions, // unchanged
            modes: {
                default_key: "league:1",
                items: modeItems,
            },
            answers_for_you,
            participants: participantsPayload,
            margin_view,
            solutions: solutionsByQid,
        };
    }
}

function round2(n: number) {
    return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────
// Canonicalization helpers (strict, no fallbacks)
function canonicalizeMarginValue(rt: string, raw: unknown): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;

    switch (rt) {
        case "time": {
            // Accept "HH:MM:SS" or seconds-as-string/number → return seconds string
            if (s.includes(":")) {
                const parts = s.split(":").map((x) => Number.parseInt(x, 10) || 0);
                const [h, m, sec] =
                    parts.length === 3 ? parts : parts.length === 2 ? [0, parts[0], parts[1]] : [0, 0, parts[0] ?? 0];
                const total = h * 3600 + m * 60 + sec;
                return String(total);
            }
            return String(Number.parseInt(s, 10) || 0);
        }
        case "mcm": {
            // Accept "8,05" or "8.05" meters → centimeters integer string
            const meters = Number(s.replace(",", "."));
            if (!Number.isFinite(meters)) return "0";
            const cm = Math.round(meters * 100);
            return String(cm);
        }
        case "number":
        case "decimal": {
            // Accept comma or dot → canonical dot decimal string
            const num = Number(s.replace(",", "."));
            if (!Number.isFinite(num)) return "0";
            return String(num);
        }
        default:
            return s; // already canonical or list; untouched
    }
}

// ─────────────────────────────────────────────────────────────
let _svc: PredictionsService | null = null;

function service(): PredictionsService {
    if (_svc) return _svc;
    const predRepo = new PredictionsRepo(pool);
    const answersRepo = new AnswersRepo(pool);
    const solutionsRepo = new SolutionsRepo(pool);
    const betsRepo = new BetsRepo(pool);
    const betsService = new BetsService(betsRepo);
    _svc = new PredictionsService(betsService, answersRepo, solutionsRepo, predRepo);
    return _svc;
}

export async function composeBundle(args: ComposeArgs) {
    return service().composeBundle(args);
}

/*
Changes summary (bundle endpoint refactor to canonical payload, 2025-11-18, updated after feedback):

1) ComposeArgs:
   - { betId, groupCode, userId } — matches /bundle/:betId/:groupCode/:userId.

2) Virtual & squads:
   - virtual is derived purely from main.virtual (mainIsVirtual).
   - Squads are always computed; no includeSquads switch.

3) Modes:
   - modes: { default_key, items[] } with:
       key ("league:1", "league:2".., "squads"),
       label, icon_url, type ("score" | "points" | "squads"),
       sequence (from classification.current), virtual flag.

4) Non-margin payload:
   - Single participants array (ordered by league:1 actual desc, potential desc, name asc).
   - Each participant:
       user: { id, display_name }
       bundle: { eliminated, gray, virtual, modes: { [modeKey]: { actual, potential } } }
       lines: [
         { question_id, label, list_item_id, gray,
           modes: { [modeKey]: { actual, potential } } }
       ]

5) Margin payload:
   - is_margin_bundle flag set when main.margin > 0 and resulttype in { number, time, mcm, decimal }.
   - answers_for_you = null; “you” is resolved client-side via currentUserId inside margin_view.values[*].participants.
   - margin_view:
       {
         main_qid,
         has_solution,
         values: [
           {
             result, label, is_solution,
             possible, gray,
             modes: {
               // leagues only; squads are at participant level
               "league:1": { actual, potential },
               "league:2": { actual, potential }, ...
             },
             participants: [
               {
                 id, display_name,
                 is_captain: boolean,
                 modes: {
                   squads: {
                     actual,        // per-question squads contribution for this value
                     potential,     // per-question potential for this value
                     dropped,       // true if this user was dropped in squads for this value
                     is_squad_member // true iff user is in any squad in this season
                   }
                 }
               }
             ]
           }
         ],
         selected_index,
         middle_index
       }

6) Previous bug fix (inflated potentials):
   - Value-level league modes no longer sum all participants for that result.
     They now represent a prediction-level bundle value (same structure as non-margin).

7) Value-level ACTUAL for correct prediction:
   - For each value and league, we look at all participants with that value
     and take the maximum actual/potential across them (per league) for points
     leagues 2..10, while league:1 uses the per-question answer.score/points
     from the DB for that canonical value.
   - This guarantees that when a prediction is actually correct for some user(s),
     modes[league:*].actual for that value is non-zero and matches real scoring,
     instead of accidentally picking an alphabetically-first user with 0.

8) Squads.actual per participant in margin_view:
   - For margin bundles we recompute squads contributions PER VALUE:
       • Start from answer.score (actual) and answer.points (potential) in the
         answer table for (question, canonical result, user).
       • For each value and for each squad:
           - include all squad members (even if they did not predict that value,
             they participate with base score 0);
           - double captain scores;
           - drop the single lowest per squad (if there are ≥ 2 members);
           - normalize survivors by factor = smallestSquadSize / squadSize.
       • The normalized per-user contributions for that value are exposed as:
           participants[*].modes.squads.actual / .potential for that value.

9) NEW feature — captain + dropped flags for margin-view squads (2025-11-18):
   - For every margin_view.values[*].participants[*]:
       • is_captain is derived from squad_users.is_captain via memberOf map.
       • dropped is true iff, for that prediction value, the user is the single
         dropped member in their squad (lowest doubled score) according to
         the squads rules.

10) NEW feature — is_squad_member for margin-view squads (2025-11-18, follow-up):
   - participants[*].modes.squads.is_squad_member is true iff the user appears
     in squad_users for the current open season; otherwise false.
   - For non-squad users we now emit:
       actual = 0, potential = 0, dropped = false, is_squad_member = false.
   - This lets the FE distinguish “no team” users from team members whose
     contribution happens to be 0 or dropped, without changing any scoring.

11) FEEDBACK CHANGES (A & B — 2025-11-18):
   - A) Eliminated was removed from margin_view.values[*]. We now expose only:
        { result, label, is_solution, possible, gray, modes, participants }.
        The “eliminated vs possible” information for margin is fully captured
        by (possible, gray) and by participant-level eliminated flags in the
        non-margin bundle header; value-level eliminated was redundant noise.
   - B) Margin value grouping for answers no longer relies on any legacy
        HH:MM:SS forms. For the margin_view we now treat answer.result as
        already canonical:
          const canon = String(a.result ?? "").trim();
        We no longer call canonicalizeMarginValue() for answers inside
        margin_view; this guarantees that a value group like "7474" contains
        only rows where result = "7474" in the DB, and never any hypothetical
        "02:04:34" variants. canonicalizeMarginValue() is still used for
        solutions so existing HH:MM:SS solution rows continue to work, but
        the value-level gray/possible logic for margin is now strictly based
        on the stored canonical result values.

12) NEW gray semantics for margin values (2025-11-18, this change):
   - We now derive value-level gray *only* from answer.gray per result, no
     longer mixing in participant elimination:
       • For each canonical result v we track:
           anyGray      := exists row with result=v and gray=1
           anyNonGray   := exists row with result=v and gray=0
       • If there is at least one answer for v:
           - if anyGray && !anyNonGray → chip.gray = 1 (fully greyed)
           - otherwise (at least one non-grey row) → chip.gray = 0
       • If there are no answers for v:
           - if v equals the solution → chip.gray = 0
           - else → chip.gray = 1
   - Possible still follows the bundle rules and uses elimination on the
     participant header, but gray for margin chips now reflects exactly
     what the admin set in the DB for that result.
*/