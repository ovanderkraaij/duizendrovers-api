//src/modules/answers/answers.service.ts
import {AnswersRepo} from "./answers.repo";
import {QuestionsRepo} from "../questions/questions.repo";
import {
    buildVariantsBySteps,
    decimalsFromStep,
    displayFromMCM,
    displayFromTimeSeconds,
    formatLabelComma,
    formatResultDot,
    normalizeDecimal,
    normalizeMCM,
    normalizeScoreWithDraw,
    normalizeTime
} from "../../utils/normalize";

/**
 * Handles user submissions and equal-answer recalculation.
 * Storage rules:
 * - LIST:   result=item.label, label=item.label, listitem_id=id (compare by listitem_id)
 * - TIME:   posted=1 row keeps EXACT user input in label; result=seconds
 *           margin variants (posted=0) use auto HH:MM:SS labels from seconds
 * - MCM:    posted=1 row keeps EXACT user input in label; result=total centimeters
 * - OPEN:   result=label=trimmed input
 * - DECIMAL: keep canonical label/result from normalizeDecimal
 * - SCORE sports: label=user score string, result=canonical (with draw tag)
 */
export class AnswerService {
    constructor(
        private answers: AnswersRepo,
        private questions: QuestionsRepo
    ) {
    }

    async submitBatchRaw(payload: {
        betId: number;
        userId: number;
        submissions: Array<| { questionId: number; listItemId: number }  // list
            | { questionId: number; label: string }       // time/decimal/mcm/open/football/hockey
            >;
    }) {
        for (const sub of payload.submissions) {
            const q = await this.questions.getQuestionById((sub as any).questionId);
            if (!q) throw new Error(`Question not found: ${(sub as any).questionId}`);

            const rt = (await this.questions.getResultTypeLabelForQuestion(q.id)).toLowerCase();

            if (rt === "list") {
                const listItemId = (sub as any).listItemId as number | undefined;
                if (listItemId == null) throw new Error(`Missing listItemId for list question qid=${q.id}`);
                const itemLabel = await this.questions.getListItemLabelById(listItemId);
                if (!itemLabel) throw new Error(`Label not found for listItemId=${listItemId} (qid=${q.id})`);

                await this.answers.insertAnswer({
                    questionId: q.id,
                    userId: payload.userId,
                    result: itemLabel,   // exact item.label
                    label: itemLabel,    // exact item.label
                    posted: 1,
                    listItemId,
                });
                continue;
            }

            if (rt === "time") {
                const raw = (sub as any).label as string | undefined;
                if (typeof raw !== "string") throw new Error(`Missing label (HH:MM:SS) for time question qid=${q.id}`);
                const norm = normalizeTime(raw);
                const center = Number(norm.result) || 0;

                const isMargin = q.margin != null && q.step != null;
                if (isMargin) {
                    const stepSize = Math.max(1, Math.abs(Number(q.step!)));   // seconds
                    const stepCount = Math.max(0, Math.round(Math.abs(Number(q.margin!)))); // number of steps
                    await this.answers.deleteUserAnswers(q.id, payload.userId);

                    const variants = buildVariantsBySteps(center, stepCount, stepSize, /*decimals*/ 0);
                    const rows = variants.map(v => ({
                        questionId: q.id,
                        userId: payload.userId,
                        result: String(Math.round(v)),
                        label: (v === center) ? raw : displayFromTimeSeconds(Math.round(v)),
                        posted: (v === center ? 1 : 0) as 1 | 0,
                        listItemId: null as number | null,
                    }));
                    await this.answers.insertAnswersMany(rows);
                } else {
                    await this.answers.insertAnswer({
                        questionId: q.id,
                        userId: payload.userId,
                        result: String(center), // normalized seconds
                        label: raw,             // EXACT user input
                        posted: 1,
                        listItemId: null,
                    });
                }
                continue;
            }

            // ── NEW: number / decimal with margin support ──────────────────────────────
            if (rt === "number" || rt === "decimal") {
                const raw = (sub as any).label as string | undefined;
                if (typeof raw !== "string") throw new Error(`Missing label for number qid=${q.id}`);

                const {result} = normalizeDecimal(raw);        // "394,5" -> "394.5"
                const center = Number(result);                    // 394.5
                if (!Number.isFinite(center)) throw new Error(`Invalid decimal center for qid=${q.id}`);
                const isMargin = q.margin != null && q.step != null;
                if (isMargin) {
                    const stepSize = Math.abs(Number(q.step!));        // e.g. 0.5
                    const stepCount = Math.max(0, Math.round(Math.abs(Number(q.margin!)))); // e.g. 6 (steps)
                    const decimals = decimalsFromStep(stepSize);

                    await this.answers.deleteUserAnswers(q.id, payload.userId);

                    const variants = buildVariantsBySteps(center, stepCount, stepSize, decimals);

                    const EPS = 1e-9;
                    const rows = variants.map(v => {
                        const isCenter = Math.abs(v - center) < EPS;
                        return {
                            questionId: q.id,
                            userId: payload.userId,
                            result: formatResultDot(v, decimals),
                            label: isCenter ? raw : formatLabelComma(v, decimals),
                            posted: (isCenter ? 1 : 0) as 1 | 0,
                            listItemId: null as number | null,
                        };
                    });
                    await this.answers.insertAnswersMany(rows);
                } else {
                    await this.answers.insertAnswer({
                        questionId: q.id,
                        userId: payload.userId,
                        result: formatResultDot(center, decimalsFromStep(0)),
                        label: raw,     // exact user input retained
                        posted: 1,
                        listItemId: null,
                    });
                }

                continue;
            }

            // ── UPDATED: mcm with margin support ───────────────────────────────────────
            if (rt === "mcm") {
                const raw = (sub as any).label as string | undefined;
                if (typeof raw !== "string") throw new Error(`Missing label for mcm qid=${q.id}`);

                const {result} = normalizeMCM(raw); // "7,23" -> "723" (cm)
                const centerCm = Number(result);
                if (!Number.isFinite(centerCm)) throw new Error(`Invalid mcm center for qid=${q.id}`);

                const isMargin = q.margin != null && q.step != null;
                if (isMargin) {
                    const stepSizeCm = Math.max(1, Math.round(Math.abs(Number(q.step!))));
                    const stepCount = Math.max(0, Math.round(Math.abs(Number(q.margin!))));
                    await this.answers.deleteUserAnswers(q.id, payload.userId);

                    const variants = buildVariantsBySteps(centerCm, stepCount, stepSizeCm, /*decimals*/ 0);
                    const rows = variants.map(v => {
                        const iv = Math.round(v);
                        const isCenter = iv === centerCm;
                        return {
                            questionId: q.id,
                            userId: payload.userId,
                            result: String(iv),
                            label: isCenter ? raw : displayFromMCM(iv),
                            posted: (isCenter ? 1 : 0) as 1 | 0,
                            listItemId: null as number | null,
                        };
                    });
                    await this.answers.insertAnswersMany(rows);
                } else {
                    await this.answers.insertAnswer({
                        questionId: q.id,
                        userId: payload.userId,
                        result: String(centerCm),
                        label: raw,
                        posted: 1,
                        listItemId: null,
                    });
                }
                continue;
            }

            if (rt === "football" || rt === "hockey" || rt === "score") {
                const raw = (sub as any).label as string | undefined;
                if (typeof raw !== "string") throw new Error(`Missing label (score) for qid=${q.id}`);
                const {result} = normalizeScoreWithDraw(raw);
                await this.answers.insertAnswer({
                    questionId: q.id,
                    userId: payload.userId,
                    result,     // canonical
                    label: raw, // EXACT user input
                    posted: 1,
                    listItemId: null,
                });
                continue;
            }

            // OPEN (default)
            {
                const raw = (sub as any).label as string | undefined;
                if (typeof raw !== "string") throw new Error(`Missing label for open qid=${q.id}`);
                const trimmed = raw.trim();
                await this.answers.insertAnswer({
                    questionId: q.id,
                    userId: payload.userId,
                    result: trimmed,
                    label: trimmed,
                    posted: 1,
                    listItemId: null,
                });
            }
        }

        await this.equalAnswerPoints(payload.betId, payload.userId);
        return {saved: payload.submissions.length};
    }

    private async equalAnswerPoints(betId: number, userId: number) {
        const mains = await this.questions.getMainQuestions(betId);

        for (const main of mains) {
            const subs = await this.questions.getSubs(main.groupcode);
            const bonuses = await this.questions.getBonuses(main.groupcode);
            const hasSubs = subs.length > 0;
            const hasBonus = bonuses.length > 0;

            if (hasSubs || hasBonus) {
                if (hasSubs && main.points === 20) {
                    await this.handleBundleNoBonus(main.id, userId, 20);
                } else {
                    await this.handleBundleWithBonus(main.id, userId, main.points, bonuses);
                }
            } else {
                if (main.margin == null) {
                    await this.applyPointsForSameMainOnly(main.id, userId, main.points);
                } else {
                    const answers = await this.answers.getAnswersForUserMargin(main.id, userId);
                    for (const a of answers) {
                        const matches = await this.answers.countMatchesForResult(main.id, a.result);
                        if (matches > 0) {
                            const pts = main.points / matches;
                            await this.answers.updatePointsForExactResult(main.id, a.result, pts);
                        }
                    }
                }
            }
        }
    }

    private async applyPointsForSameMainOnly(mainId: number, _userId: number, maxPoints: number) {
        const rtLabel = await this.getResultTypeLabelForQuestion(mainId);
        if (rtLabel === "list") {
            await this.answers.recomputeSimpleMainListPoints(mainId, maxPoints);
        } else {
            await this.answers.recomputeSimpleMainNonListPoints(mainId, maxPoints);
        }
    }

    private async handleBundleNoBonus(mainId: number, userId: number, totalPoints: number) {
        const group = await this.getGroupQuestionsForMain(mainId);
        if (group.length === 0) return;

        const usersMap = await this.fetchUserAnswerMap(group.map(q => q.id), userId);
        for (const q of group) if (!usersMap.has(q.id)) return;

        const {sqlCount, paramsCount} = await this.buildBundleMatchCountSQL(group, usersMap);
        const [rowsCount] = await this.answers.pool.execute(sqlCount, paramsCount);
        const bundleCount = (rowsCount as any[])[0]?.n ?? 0;
        if (bundleCount <= 0) return;

        const pointsMain = totalPoints / bundleCount;

        const {sqlUsers, paramsUsers} = await this.buildBundleMatchUsersSQL(group, usersMap);
        const [rowsUsers] = await this.answers.pool.execute(sqlUsers, paramsUsers);
        const userIds: number[] = (rowsUsers as any[]).map(r => r.user_id);
        if (userIds.length === 0) return;

        const myMain = usersMap.get(mainId)!;
        const mainRtLabel = await this.getResultTypeLabelForQuestion(mainId);

        if (mainRtLabel === "list") {
            const sql = `UPDATE answer
                         SET points = ?
                         WHERE question_id = ?
                           AND listitem_id = ?
                           AND user_id IN (${userIds.map(() => '?').join(',')})`;
            await this.answers.pool.execute(sql, [pointsMain, mainId, myMain.listitem_id, ...userIds]);
        } else {
            const sql = `UPDATE answer
                         SET points = ?
                         WHERE question_id = ?
                           AND result = ?
                           AND user_id IN (${userIds.map(() => '?').join(',')})`;
            await this.answers.pool.execute(sql, [pointsMain, mainId, myMain.result, ...userIds]);
        }
    }

    private async handleBundleWithBonus(
        mainId: number,
        userId: number,
        mainPoints: number,
        bonuses: Array<{ id: number }>
    ) {
        const mainRtLabel = await this.getResultTypeLabelForQuestion(mainId);
        const myMain = await this.answers.getUserPostedAnswer(mainId, userId);
        if (myMain) {
            if (mainRtLabel === "list") {
                const n = await this.answers.countMatchesForListItem(mainId, myMain.listitem_id);
                if (n > 0) await this.answers.updatePointsForListItem(mainId, myMain.listitem_id, mainPoints / n);
            } else {
                const n = await this.answers.countMatchesForResult(mainId, myMain.result);
                if (n > 0) await this.answers.updatePointsForExactResult(mainId, myMain.result, mainPoints / n);
            }
        }

        if (bonuses.length > 0) {
            const bonusBundle = [{id: mainId}, ...bonuses];

            const usersMap = await this.fetchUserAnswerMap(bonusBundle.map(q => q.id), userId);
            for (const q of bonusBundle) if (!usersMap.has(q.id)) return;

            const {sqlCount, paramsCount} = await this.buildBundleMatchCountSQL(bonusBundle as any[], usersMap);
            const [rowsCount] = await this.answers.pool.execute(sqlCount, paramsCount);
            const bundleCount = (rowsCount as any[])[0]?.n ?? 0;
            if (bundleCount <= 0) return;

            const remainder = 20 - mainPoints;
            const pointsPerSub = remainder / bundleCount / bonuses.length;

            const {sqlUsers, paramsUsers} = await this.buildBundleMatchUsersSQL(bonusBundle as any[], usersMap);
            const [rowsUsers] = await this.answers.pool.execute(sqlUsers, paramsUsers);
            const userIds: number[] = (rowsUsers as any[]).map(r => r.user_id);
            if (userIds.length === 0) return;

            for (const bonus of bonuses) {
                const rt = await this.getResultTypeLabelForQuestion(bonus.id);
                const u = usersMap.get(bonus.id)!;
                if (rt === "list") {
                    const sql = `UPDATE answer
                                 SET points = ?
                                 WHERE question_id = ?
                                   AND listitem_id = ?
                                   AND user_id IN (${userIds.map(() => '?').join(',')})`;
                    await this.answers.pool.execute(sql, [pointsPerSub, bonus.id, u.listitem_id, ...userIds]);
                } else {
                    const sql = `UPDATE answer
                                 SET points = ?
                                 WHERE question_id = ?
                                   AND result = ?
                                   AND user_id IN (${userIds.map(() => '?').join(',')})`;
                    await this.answers.pool.execute(sql, [pointsPerSub, bonus.id, u.result, ...userIds]);
                }
            }
        }
    }

    // ----------------- helpers -----------------

    private async getGroupQuestionsForMain(mainId: number) {
        const [rows] = await this.answers.pool.execute(
            `SELECT groupcode
             FROM question
             WHERE id = ?`,
            [mainId]
        );
        const groupcode = (rows as any[])[0]?.groupcode as number | undefined;
        if (!groupcode) return [];
        return this.questions.getGroupQuestions(groupcode);
    }

    private async fetchUserAnswerMap(qids: number[], userId: number) {
        if (qids.length === 0) return new Map<number, any>();
        const placeholders = qids.map(() => '?').join(',');
        const sql = `SELECT question_id, result, listitem_id
                     FROM answer
                     WHERE user_id = ?
                       AND posted = '1'
                       AND question_id IN (${placeholders})`;
        const [rows] = await this.answers.pool.execute(sql, [userId, ...qids]);
        const map = new Map<number, any>();
        for (const r of rows as any[]) map.set(r.question_id, r);
        return map;
    }

    private async getResultTypeLabelForQuestion(qid: number) {
        const sql = `SELECT r.label
                     FROM question q
                              INNER JOIN resulttype r ON q.resulttype_id = r.id
                     WHERE q.id = ?`;
        const [rows] = await this.answers.pool.execute(sql, [qid]);
        return (rows as any[])[0]?.label as string;
    }

    private buildMarginVariants(centerSeconds: number, margin: number, step: number): number[] {
        const s = Math.max(1, Math.abs(step));
        const m = Math.max(0, Math.abs(margin));
        const variants: number[] = [];
        variants.push(centerSeconds);
        for (let off = s; off <= m; off += s) {
            const down = centerSeconds - off;
            const up = centerSeconds + off;
            if (down >= 0) variants.push(down);
            variants.push(up);
        }
        variants.sort((a, b) => a - b);
        const uniq: number[] = [];
        for (const v of variants) if (uniq.length === 0 || uniq[uniq.length - 1] !== v) uniq.push(v);
        return uniq;
    }

    private async buildBundleMatchCountSQL(
        group: Array<{ id: number }>,
        usersMap: Map<number, any>
    ) {
        if (group.length === 0) return {sqlCount: "SELECT 0 AS n", paramsCount: []};

        const ors: string[] = [];
        const params: any[] = [];

        for (const q of group) {
            const u = usersMap.get(q.id);
            if (!u) continue;
            const rtLabel = await this.getResultTypeLabelForQuestion(q.id);
            if (rtLabel === "list") {
                ors.push(`(a.question_id = ? AND a.posted = '1' AND a.listitem_id = ?)`);
                params.push(q.id, u.listitem_id);
            } else {
                ors.push(`(a.question_id = ? AND a.posted = '1' AND a.result = ?)`);
                params.push(q.id, u.result);
            }
        }

        if (ors.length === 0) return {sqlCount: "SELECT 0 AS n", paramsCount: []};

        const need = ors.length;
        const sql = `
            SELECT COUNT(*) AS n
            FROM (SELECT a.user_id
                  FROM answer a
                  WHERE ${ors.join(" OR ")}
                  GROUP BY a.user_id
                  HAVING COUNT(DISTINCT a.question_id) = ${need}) AS t
        `;

        return {sqlCount: sql, paramsCount: params};
    }

    private async buildBundleMatchUsersSQL(
        group: Array<{ id: number }>,
        usersMap: Map<number, any>
    ) {
        if (group.length === 0) return {sqlUsers: "SELECT 0 AS user_id LIMIT 0", paramsUsers: []};

        const ors: string[] = [];
        const params: any[] = [];

        for (const q of group) {
            const u = usersMap.get(q.id);
            if (!u) continue;
            const rtLabel = await this.getResultTypeLabelForQuestion(q.id);
            if (rtLabel === "list") {
                ors.push(`(a.question_id = ? AND a.posted = '1' AND a.listitem_id = ?)`);
                params.push(q.id, u.listitem_id);
            } else {
                ors.push(`(a.question_id = ? AND a.posted = '1' AND a.result = ?)`);
                params.push(q.id, u.result);
            }
        }

        if (ors.length === 0) return {sqlUsers: "SELECT 0 AS user_id LIMIT 0", paramsUsers: []};

        const need = ors.length;
        const sql = `
            SELECT a.user_id AS user_id
            FROM answer a
            WHERE ${ors.join(" OR ")}
            GROUP BY a.user_id
            HAVING COUNT(DISTINCT a.question_id) = ${need}
        `;

        return {sqlUsers: sql, paramsUsers: params};
    }
}