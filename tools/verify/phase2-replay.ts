// tools/verify/phase2-replay.ts
import type { Pool } from 'mysql2/promise';
import { AnswersRepo } from '../../src/modules/answers/answers.repo';
import { QuestionsRepo } from '../../src/modules/questions/questions.repo';
import { PreclassificationRepo } from '../../src/modules/preclassification/preclassification.repo';
import { SolutionsRepo } from '../../src/modules/solutions/solutions.repo';

import { AnswerService } from '../../src/modules/answers/answers.service';
import { PreclassificationService } from '../../src/modules/preclassification/preclassification.service';
import { SolutionsService } from '../../src/modules/solutions/solutions.service';

// Supported resulttype labels (lowercased)
type RT =
    | 'list' | 'time' | 'decimal' | 'mcm'
    | 'football' | 'hockey' | 'score'
    | 'number' | 'date' | 'toto' | 'f1' | 'bestof7';

function mapResulttype(rt: RT): 'list'|'time'|'decimal'|'mcm'|'open'|'football'|'hockey' {
    switch (rt) {
        case 'list':     return 'list';
        case 'time':     return 'time';
        case 'decimal':  return 'decimal';
        case 'mcm':      return 'mcm';
        case 'football': return 'football';
        case 'hockey':   return 'hockey';
        case 'score':    return 'football';
        default:         return 'open';
    }
}

export interface ReplayOpts {
    seasonId: number;
    src: Pool;
    tgt: Pool;
}

export async function replaySubmissions({ seasonId, src, tgt }: ReplayOpts) {
    // Build services on TARGET (same code path as API)
    const answersRepo = new AnswersRepo(tgt);
    const questionsRepo = new QuestionsRepo(tgt);
    const preRepo = new PreclassificationRepo(tgt);
    const solsRepo = new SolutionsRepo(tgt);

    const answerSvc = new AnswerService(answersRepo, questionsRepo);
    const preSvc = new PreclassificationService(preRepo);
    const solsSvc = new SolutionsService(solsRepo);

    // Preload TARGET resulttype per question_id (authoritative)
    const [rtRows] = await tgt.query<any[]>(
        `
      SELECT q.id AS qid, LOWER(rt.label) AS rt_label
      FROM question q
      JOIN resulttype rt ON rt.id = q.resulttype_id
      JOIN bet b         ON b.id = q.bet_id
      WHERE b.season_id = ?
    `,
        [seasonId]
    );
    const rtByQid = new Map<number, RT>(
        (rtRows as any[]).map(r => [Number(r.qid), String(r.rt_label).toLowerCase() as RT])
    );

    // Load SOURCE posted=1 answers to replay
    const [rows] = await src.query<any[]>(
        `
      SELECT
        b.id            AS bet_id,
        a.user_id,
        a.id            AS answer_id,
        a.question_id,
        a.result,
        a.label,
        a.listitem_id,
        a.posted
      FROM answer a
      JOIN question q ON q.id = a.question_id
      JOIN bet b      ON b.id = q.bet_id
      WHERE b.season_id = ?
        AND a.posted = '1'
      ORDER BY b.id, a.user_id, a.id
    `,
        [seasonId]
    );

    // Group by (bet,user)
    const groups = new Map<string, any[]>();
    for (const r of rows) {
        const key = `${r.bet_id}:${r.user_id}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }

    console.log(`[Phase 2] Replay via API | groups=${groups.size} rows=${rows.length} (posted=1 from SOURCE)`);

    const touchedBetIds = new Set<number>();
    let batches = 0;

    for (const [, items] of groups) {
        // Preserve original submission order
        items.sort((a, b) => Number(a.answer_id) - Number(b.answer_id));

        const betId  = Number(items[0].bet_id);
        const userId = Number(items[0].user_id);
        touchedBetIds.add(betId);

        // Build canonical submissions:
        // - list  : { questionId, listItemId }
        // - other : { questionId, label }
        const submissions = items.map(it => {
            const qid   = Number(it.question_id);
            const rtLbl = (rtByQid.get(qid) ?? 'open') as RT;
            const kind  = mapResulttype(rtLbl);

            if (kind === 'list') {
                const li = it.listitem_id == null ? null : Number(it.listitem_id);
                if (li == null || Number.isNaN(li)) {
                    throw new Error(`Replay missing listitem_id for list question qid=${qid} (uid=${userId}, aid=${it.answer_id})`);
                }
                return { questionId: qid, listItemId: li };
            }

            return { questionId: qid, label: String(it.label ?? '') };
        });

        await answerSvc.submitBatchRaw({ betId, userId, submissions });
        await preSvc.rebuild(betId, new Date());
        batches++;
    }

    for (const betId of touchedBetIds) {
        await solsSvc.markCorrectAndScore(betId);
    }

    // Sanity after replay
    const [[{ cnt, nonnull_result, nonnull_list }]]: any = await tgt.query(
        `
      SELECT
        COUNT(*) AS cnt,
        SUM(a.result IS NOT NULL AND a.result <> 'undefined') AS nonnull_result,
        SUM(a.listitem_id IS NOT NULL) AS nonnull_list
      FROM answer a
      JOIN question q ON q.id=a.question_id
      JOIN bet b      ON b.id=q.bet_id
      WHERE b.season_id=?
    `,
        [seasonId]
    );
    console.log(`[Phase 2] Target answers: ${cnt} | result!=NULL: ${nonnull_result} | listitem_id!=NULL: ${nonnull_list}`);

    return { batches, totalAnswers: rows.length };
}