//src/modules/solutions/solutions.service.ts
import { ID, ResultTypeLabel } from "../../types/domain";
import { SolutionsRepo } from "./solutions.repo";
import {
    normalizeTime,
    normalizeDecimal,
    normalizeMCM,
    normalizeScoreWithDraw,
} from "../../utils/normalize";
import { canonicalKey } from "../../domain/scoring";

type Row = Record<string, any>;

export class SolutionsService {
    constructor(private repo: SolutionsRepo) {}

// src/modules/solutions/solutions.service.ts
    async setSolution(params: {
        questionId: ID;
        type: ResultTypeLabel;
        payload: {
            label?: string;
            baseScore?: string;
            drawTag?: "twnv" | "uwnv" | "twns" | "uwns";
            listItemId?: ID | null;
        };
    }): Promise<{ ok: true }> {
        const { questionId, type, payload } = params;
        let result = "";

        switch (type) {
            case "list":
                if (!payload.listItemId) throw new Error("listItemId required for list type");
                result = String(payload.listItemId);
                await this.repo.addSolution(Number(questionId), result, Number(payload.listItemId));
                break;

            case "time":
                result = normalizeTime(payload.label!).result;
                await this.repo.addSolution(Number(questionId), result, null);
                break;

            case "decimal":
                result = normalizeDecimal(payload.label!).result;
                await this.repo.addSolution(Number(questionId), result, null);
                break;

            case "mcm":
                result = normalizeMCM(payload.label!).result;
                await this.repo.addSolution(Number(questionId), result, null);
                break;

            case "open":
                result = (payload.label ?? "").trim();
                await this.repo.addSolution(Number(questionId), result, null);
                break;

            case "football":
            case "hockey":
                result = normalizeScoreWithDraw(payload.baseScore!, payload.drawTag).result;
                await this.repo.addSolution(Number(questionId), result, null);
                break;

            default:
                throw new Error(`Unsupported result type: ${type}`);
        }

        return { ok: true };
    }

    /**
     * Mark correctness + score for this bet.
     *
     * Frozen rules:
     * - Singles: if correct => correct=1, score = answer.points; else 0.
     * - Bundle (main + subs): unit correct iff ALL (main + subs) match official.
     *     When unit correct: only MAIN gets correct=1 and score=MAIN.points.
     *     Subs never receive correct=1 and always score=0.
     * - Bonuses: eligible only if MAIN is correct AND all bonuses correct.
     *     When unit correct: only FIRST bonus gets correct=1 AND score = SUM(points of all bonus answers).
     *     Others: 0/0. If not fully correct: all 0/0.
     * - Margin: multiple rows per user/qid (center + generated variants).
     *     Do NOT recompute points. Mark exactly the matching variant 1/points; others 0/0.
     */
    async markCorrectAndScore(betId: number): Promise<{ ok: true }> {
        // 0) Reset posted rows + unposted margin rows
        await this.repo.resetCorrectAndScoreForBet(betId);

        // 1) Build groups
        const mains = await this.repo.getMainQuestionsForBet(betId);
        if (mains.length === 0) return { ok: true };

        type Row = Record<string, any>;
        const groupByRoot = new Map<
            number,
            { rootId: number; groupcode: number; subs: number[]; bonuses: number[] }
            >();
        const allQids: number[] = [];

        for (const m of mains as Row[]) {
            const rootId = Number(m.id);
            const groupcode = Number(m.groupcode);
            const group = await this.repo.getGroupQuestions(groupcode); // ORDER BY lineup

            const subs: number[] = [];
            const bonuses: number[] = [];
            for (const q of group) {
                const qid = Number(q.id);
                if (qid === rootId) continue;
                const pts = Number(q.points || 0);
                if (pts === 0) subs.push(qid);
                else bonuses.push(qid);
            }

            groupByRoot.set(rootId, { rootId, groupcode, subs, bonuses });
            allQids.push(rootId, ...subs, ...bonuses);
        }

        const uniqQids = Array.from(new Set(allQids));

        // 2) Result types + margin flags
        const rtRows = await this.repo.getResulttypesForQids(uniqQids);
        const rtByQid = new Map<number, string>();
        const marginQids = new Set<number>();
        for (const r of rtRows as Row[]) {
            const qid = Number(r.qid);
            rtByQid.set(qid, String(r.rt_label || "").toLowerCase());
            const hasMargin = r.q_margin != null && r.q_step != null;
            if (hasMargin) marginQids.add(qid);
        }

        // 3) Official keys (supports multiple solutions)
        const solRows = await this.repo.getSolutionsForQids(uniqQids);
        const officialKeysByQid = new Map<number, Set<string>>();
        const addOfficialKey = (qid: number, key: string) => {
            if (!officialKeysByQid.has(qid)) officialKeysByQid.set(qid, new Set());
            officialKeysByQid.get(qid)!.add(key);
        };

        for (const s of solRows as Row[]) {
            const qid = Number(s.question_id);
            const rt = (rtByQid.get(qid) || "").toLowerCase();

            if (rt === "list") {
                const li = s.listitem_id != null ? Number(s.listitem_id) : null;
                addOfficialKey(qid, canonicalKey({ listItemId: li, value: null, label: null }));
            } else {
                let offVal = s.result != null ? String(s.result) : "";
                switch (rt) {
                    case "time":    offVal = normalizeTime(offVal).result;    break;
                    case "decimal": offVal = normalizeDecimal(offVal).result; break;
                    case "mcm":     offVal = normalizeMCM(offVal).result;     break;
                    case "open":    offVal = (offVal ?? "").trim();           break;
                    default: break; // football/hockey kept as stored
                }
                addOfficialKey(qid, canonicalKey({ listItemId: null, value: offVal, label: null }));
            }
        }

        // 4) Posted answers
        const postedRows = await this.repo.getPostedAnswersForBet(betId);
        type A = {
            id: number;
            user_id: number;
            question_id: number;
            listitem_id: number | null;
            result: string | null;
            answer_points: number;     // legacy equalized points; not used for division now
            question_points: number;   // configured points on the question
        };

        const answersByUser = new Map<number, Map<number, A>>();
        const allPosted: A[] = [];
        const postedByQid = new Map<number, A[]>();

        for (const r of postedRows as Row[]) {
            const a: A = {
                id: Number(r.id),
                user_id: Number(r.user_id),
                question_id: Number(r.question_id),
                listitem_id: r.listitem_id != null ? Number(r.listitem_id) : null,
                result: r.result != null ? String(r.result) : null,
                answer_points: Number(r.answer_points ?? 0),
                question_points: Number(r.question_points ?? 0),
            };
            allPosted.push(a);
            if (!answersByUser.has(a.user_id)) answersByUser.set(a.user_id, new Map());
            answersByUser.get(a.user_id)!.set(a.question_id, a);
            if (!postedByQid.has(a.question_id)) postedByQid.set(a.question_id, []);
            postedByQid.get(a.question_id)!.push(a);
        }

        // Helper: correctness vs multiple solutions
        const isAnswerCorrect = (
            qid: number,
            a: { listitem_id: number | null; result: string | null } | undefined
        ): boolean => {
            if (!a) return false;
            const rt = (rtByQid.get(qid) || "").toLowerCase();
            const userKey =
                rt === "list"
                    ? canonicalKey({ listItemId: a.listitem_id, value: null, label: null })
                    : canonicalKey({ listItemId: null, value: a.result, label: null });
            const set = officialKeysByQid.get(qid);
            return !!set && set.has(userKey);
        };

        // Updates accumulator
        const updates = new Map<number, { answerId: number; correct: 0 | 1; score: number }>();
        const put = (answerId: number, correct: 0 | 1, score: number) =>
            updates.set(answerId, { answerId, correct, score });

        // Structure sets
        const subsQids = new Set<number>();
        const bonusQids = new Set<number>();
        const mainsWithSubs = new Set<number>();
        for (const [rootId, meta] of groupByRoot) {
            if (meta.subs.length > 0) mainsWithSubs.add(rootId);
            for (const sid of meta.subs) subsQids.add(sid);
            for (const bid of meta.bonuses) bonusQids.add(bid);
        }

        // 7) Singles & non-bundle mains (non-margin, non-sub, non-bonus, not a bundle root)
        for (const [qid, arr] of postedByQid) {
            if (marginQids.has(qid)) continue;
            if (subsQids.has(qid)) continue;
            if (bonusQids.has(qid)) continue;
            if (mainsWithSubs.has(qid)) continue;

            const winners = arr.filter(a => isAnswerCorrect(qid, a));
            const n = winners.length;
            if (n === 0) continue;

            const per = (arr[0]?.question_points ?? 0) / n;
            for (const w of winners) put(w.id, 1, per);
        }

        // 8) Bundles — main only receives divided score; subs remain 0/0
        for (const [rootId, meta] of groupByRoot) {
            if (!mainsWithSubs.has(rootId)) continue;

            const mainArr = postedByQid.get(rootId) ?? [];
            const winners: A[] = [];

            for (const mainA of mainArr) {
                if (!isAnswerCorrect(rootId, mainA)) continue;
                let allSubsCorrect = true;
                for (const sid of meta.subs) {
                    const subA = answersByUser.get(mainA.user_id)?.get(sid);
                    if (!subA || !isAnswerCorrect(sid, subA)) { allSubsCorrect = false; break; }
                }
                if (allSubsCorrect) winners.push(mainA);
            }

            const n = winners.length;
            const per = n > 0 ? (mainArr[0]?.question_points ?? 0) / n : 0;

            for (const mainA of mainArr) {
                const win = winners.some(w => w.id === mainA.id);
                put(mainA.id, win ? 1 : 0, win ? per : 0);
            }
            for (const sid of meta.subs) {
                const arr = postedByQid.get(sid) ?? [];
                for (const a of arr) put(a.id, 0, 0);
            }
        }

        // 9) Bonuses — only if main correct and all bonuses correct; first bonus gets divided pot
        for (const [rootId, meta] of groupByRoot) {
            if (meta.bonuses.length === 0) continue;

            const rootIsBundle = mainsWithSubs.has(rootId);
            const mainArr = postedByQid.get(rootId) ?? [];
            const mainWinnerUserIds = new Set<number>();

            if (rootIsBundle) {
                for (const a of mainArr) {
                    const upd = updates.get(a.id);
                    if (upd && upd.correct === 1) mainWinnerUserIds.add(a.user_id);
                }
            } else {
                for (const a of mainArr) {
                    if (isAnswerCorrect(rootId, a)) mainWinnerUserIds.add(a.user_id);
                }
            }

            const bonusWinners: number[] = [];
            for (const uid of mainWinnerUserIds) {
                let allCorrect = true;
                for (const bid of meta.bonuses) {
                    const bA = answersByUser.get(uid)?.get(bid);
                    if (!bA || !isAnswerCorrect(bid, bA)) { allCorrect = false; break; }
                }
                if (allCorrect) bonusWinners.push(uid);
            }

            let pot = 0;
            for (const bid of meta.bonuses) {
                const sample = postedByQid.get(bid)?.[0];
                pot += Number(sample?.question_points ?? 0);
            }

            const nWinners = bonusWinners.length;
            const per = nWinners > 0 ? pot / nWinners : 0;
            const firstBonusId = meta.bonuses[0];

            for (const uid of bonusWinners) {
                const firstA = answersByUser.get(uid)?.get(firstBonusId);
                if (firstA) put(firstA.id, 1, per);
            }
            for (const bid of meta.bonuses) {
                const arr = postedByQid.get(bid) ?? [];
                for (const a of arr) {
                    if (!updates.has(a.id)) put(a.id, 0, 0);
                }
            }
        }

        // 10) Margin — pick exactly one matching variant per user/qid; use that variant’s stored points
        const marginQidsArray = Array.from(marginQids);
        if (marginQidsArray.length > 0) {
            const marginRows = await this.repo.getAllAnswersForQidsInBet(betId, marginQidsArray);

            type M = {
                id: number;
                user_id: number;
                question_id: number;
                listitem_id: number | null;
                result: string | null;
                points: number;
                posted: 0 | 1;
            };

            const variantsByUserQid = new Map<string, M[]>();
            for (const r of marginRows as Row[]) {
                const m: M = {
                    id: Number(r.id),
                    user_id: Number(r.user_id),
                    question_id: Number(r.question_id),
                    listitem_id: r.listitem_id != null ? Number(r.listitem_id) : null,
                    result: r.result != null ? String(r.result) : null,
                    points: Number(r.answer_points ?? 0),
                    posted: Number(r.posted) as 0 | 1,
                };
                const key = `${m.user_id}:${m.question_id}`;
                if (!variantsByUserQid.has(key)) variantsByUserQid.set(key, []);
                variantsByUserQid.get(key)!.push(m);
            }

            for (const [, arr] of variantsByUserQid) {
                let winner: M | null = null;
                for (const v of arr) {
                    if (v.posted === 1 && isAnswerCorrect(v.question_id, v)) { winner = v; break; }
                }
                if (!winner) {
                    for (const v of arr) { if (isAnswerCorrect(v.question_id, v)) { winner = v; break; } }
                }
                for (const v of arr) {
                    if (winner && v.id === winner.id) put(v.id, 1, v.points);
                    else put(v.id, 0, 0);
                }
            }
        }

        await this.repo.batchUpdateCorrectScoreByAnswerId(Array.from(updates.values()));
        return { ok: true };
    }
}