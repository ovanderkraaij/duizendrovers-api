// tools/verify/phase3-diff.ts
import type { Pool } from 'mysql2/promise';

export interface SideVals {
    points: number | null;
    score: number | null;
    correct: number | null;
    result: string | null;
    label: string | null;
    listitem_id: number | null;
    resulttype_id: number | null;
    resulttype_label: string | null;
    posted: number | null;
}

export interface DiffItem {
    sourceAnswerId: number;
    targetAnswerId: number | null;
    questionId: number;
    userId: number;
    resulttypeId: number | null;
    resulttypeLabel: string | null;
    reasons: string[]; // points/score/correct/value/missing
    source: SideVals;
    target: SideVals | null;
}

export interface DiffResult {
    identicalCount: number;
    missingPairs: number;
    mismatches: DiffItem[];
    summary: {
        byReason: Record<string, number>;
        byResulttypeId: Record<string, number>;
        sanity?: { comparedPairs: number; accounted: number; unaccounted: number };
    };
}

const EPS = 1e-6; // float tolerance

export async function diffAnswersById(seasonId: number, src: Pool, tgt: Pool): Promise<DiffResult> {
    const [srcRows] = await src.query<any[]>(
        `
      SELECT
        a.id,
        a.question_id,
        a.user_id,
        a.points, a.score, a.correct,
        a.result, a.label, a.listitem_id, a.posted,
        q.resulttype_id,
        LOWER(rt.label) AS resulttype_label
      FROM answer a
      JOIN question q    ON q.id = a.question_id
      JOIN bet b         ON b.id = q.bet_id
      JOIN resulttype rt ON rt.id = q.resulttype_id
      WHERE b.season_id = ?
    `,
        [seasonId]
    );

    const [tgtRows] = await tgt.query<any[]>(
        `
      SELECT
        a.id,
        a.question_id,
        a.user_id,
        a.points, a.score, a.correct,
        a.result, a.label, a.listitem_id, a.posted,
        q.resulttype_id,
        LOWER(rt.label) AS resulttype_label
      FROM answer a
      JOIN question q    ON q.id = a.question_id
      JOIN bet b         ON b.id = q.bet_id
      JOIN resulttype rt ON rt.id = q.resulttype_id
      WHERE b.season_id = ?
    `,
        [seasonId]
    );

    // Build a composite key that uniquely identifies a row for comparison.
    // For LIST: key = qid:uid:posted:LI:<listitem_id>
    // Else    : key = qid:uid:posted:RES:<result>
    const buildKey = (r: any) => {
        const qid = Number(r.question_id);
        const uid = Number(r.user_id);
        const posted = Number(r.posted ?? 0);
        const rt = String(r.resulttype_label ?? '').toLowerCase();
        if (rt === 'list') {
            const li = r.listitem_id == null ? '' : String(r.listitem_id);
            return `${qid}:${uid}:P${posted}:LI:${li}`;
        } else {
            const res = r.result == null ? '' : String(r.result);
            return `${qid}:${uid}:P${posted}:RES:${res}`;
        }
    };

    // Target index: allow 1:1 lookups by composite key
    const tgtMap = new Map<string, any>();
    for (const t of tgtRows) tgtMap.set(buildKey(t), t);

    let identical = 0;
    let missing = 0;
    const mismatches: DiffItem[] = [];
    const byReason: Record<string, number> = {};
    const byResulttypeId: Record<string, number> = {};

    const push = (item: DiffItem) => {
        mismatches.push(item);
        for (const r of item.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
        const rtKey = String(item.resulttypeId ?? 'unknown');
        byResulttypeId[rtKey] = (byResulttypeId[rtKey] ?? 0) + 1;
    };

    for (const s of srcRows) {
        const key = buildKey(s);
        const t = tgtMap.get(key);

        const sPoints = toNum(s.points), tPoints = t ? toNum(t.points) : null;
        const sScore  = toNum(s.score),  tScore  = t ? toNum(t.score)  : null;
        const sCorr   = toNum(s.correct),tCorr   = t ? toNum(t.correct): null;

        const sRes    = toStr(s.result),  tRes   = t ? toStr(t.result)  : null;
        const sLbl    = toStr(s.label),   tLbl   = t ? toStr(t.label)   : null;
        const sLI     = toNum(s.listitem_id), tLI = t ? toNum(t.listitem_id) : null;

        const sRTId   = toNum(s.resulttype_id), tRTId = t ? toNum(t.resulttype_id) : null;
        const sRTLab  = toStr(s.resulttype_label), tRTLab = t ? toStr(t.resulttype_label) : null;

        const sPosted = toNum(s.posted), tPosted = t ? toNum(t.posted) : null;

        if (!t) {
            missing++;
            push({
                sourceAnswerId: Number(s.id),
                targetAnswerId: null,
                questionId: Number(s.question_id),
                userId: Number(s.user_id),
                resulttypeId: sRTId ?? tRTId ?? null,
                resulttypeLabel: sRTLab ?? tRTLab ?? null,
                reasons: ['missing'],
                source: packSide(sPoints, sScore, sCorr, sRes, sLbl, sLI, sRTId, sRTLab, sPosted),
                target: null
            });
            continue;
        }

        const diffs: string[] = [];
        if (!numEqTol(sPoints, tPoints)) diffs.push('points');
        if (!numEqTol(sScore,  tScore )) diffs.push('score');
        if (!numEqStrict(sCorr, tCorr )) diffs.push('correct');

        // “value” means something about the stored value triplet isn't identical
        if (!strEq(sRes, tRes) || !strEq(sLbl, tLbl) || !numEqStrict(sLI, tLI) || !numEqStrict(sPosted, tPosted)) {
            diffs.push('value');
        }

        if (diffs.length === 0) {
            identical++;
        } else {
            push({
                sourceAnswerId: Number(s.id),
                targetAnswerId: Number(t.id),
                questionId: Number(s.question_id),
                userId: Number(s.user_id),
                resulttypeId: sRTId ?? tRTId ?? null,
                resulttypeLabel: sRTLab ?? tRTLab ?? null,
                reasons: diffs,
                source: packSide(sPoints, sScore, sCorr, sRes, sLbl, sLI, sRTId, sRTLab, sPosted),
                target: packSide(tPoints, tScore, tCorr, tRes, tLbl, tLI, tRTId, tRTLab, tPosted)
            });
        }
    }

    // Sanity counts
    const comparedPairs = srcRows.length;
    const accounted = identical + missing + mismatches.length;
    const unaccounted = comparedPairs - accounted;

    return {
        identicalCount: identical,
        missingPairs: missing,
        mismatches,
        summary: { byReason, byResulttypeId, sanity: { comparedPairs, accounted, unaccounted } }
    };
}

// helpers
function packSide(
    points: number|null, score: number|null, correct: number|null,
    result: string|null, label: string|null, listitem_id: number|null,
    resulttype_id: number|null, resulttype_label: string|null, posted: number|null
): SideVals {
    return { points, score, correct, result, label, listitem_id, resulttype_id, resulttype_label, posted };
}

function toNum(v: any): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function toStr(v: any): string | null {
    if (v == null) return null;
    const s = String(v);
    return s.length ? s : '';
}
function numEqTol(a: number | null, b: number | null) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(a - b) <= EPS;
}
function numEqStrict(a: number | null, b: number | null) {
    return a === b;
}
function strEq(a: string | null, b: string | null) {
    return (a ?? null) === (b ?? null);
}