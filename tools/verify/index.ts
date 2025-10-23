// tools/verify/index.ts
import { getConfig } from './config';
import { makePools } from './pools';
import { readBaselineFromSource } from './phase1-read';
import { replaySubmissions } from './phase2-replay';
import { diffAnswersById } from './phase3-diff';
import { writeJsonReport, writeTextReport } from './util';

async function main() {
    const cfg = getConfig();
    console.log(`[Verify] Season=${cfg.seasonId} dry=${cfg.dryRun} src=${cfg.src.name} tgt=${cfg.tgt.name}`);

    const { src, tgt } = makePools(cfg);
    try {
        // Phase 0 — clean target
        console.log(`[Phase 0] Cleaning target tables before replay...`);
        await tgt.query(`SET FOREIGN_KEY_CHECKS=0`);
        await tgt.query(`TRUNCATE TABLE answer`);
        await tgt.query(`TRUNCATE TABLE preclassification`);
        await tgt.query(`SET FOREIGN_KEY_CHECKS=1`);
        console.log(`[Phase 0] Target tables 'answer' and 'preclassification' cleared.`);

        // Phase 1 — snapshot
        console.log('[Phase 1] Read baseline from source…');
        const snapshot = await readBaselineFromSource(cfg.seasonId, src);
        console.log(`[Phase 1] Source answers: ${snapshot.answers.length}`);

        if (cfg.dryRun) {
            console.log('[Dry Run] Skipping Phases 2–3.');
            return;
        }

        // Phase 2 — replay (service); also applies solutions inside phase2-replay
        console.log('[Phase 2] Replay submissions into target (service)…');
        const rep = await replaySubmissions({ seasonId: cfg.seasonId, src, tgt });
        console.log(`[Phase 2] Replayed ${rep.totalAnswers} answers in ${rep.batches} batches.`);

        // Phase 3 — diff AFTER correctness/score have been applied
        console.log('[Phase 3] Diff target vs source by (question_id, user_id)…');
        const diff = await diffAnswersById(cfg.seasonId, src, tgt);

        const lines: string[] = [];
        lines.push(`Identical: ${diff.identicalCount}`);
        lines.push(`Missing (qid,uid) in target: ${diff.missingPairs ?? 0}`);
        lines.push(`Mismatches: ${diff.mismatches.length}`);
        lines.push(`Reasons: ${JSON.stringify(diff.summary.byReason)}`);

        console.log('[Sample mismatches x10]');
        for (const m of diff.mismatches.slice(0, 10)) {
            console.log(
                `Q${m.questionId}/U${m.userId} :: srcAID=${m.sourceAnswerId} ` +
                `tgtAID=${m.targetAnswerId ?? '∅'} reasons=${m.reasons.join(',')} | ` +
                `src{pts=${m.source.points},scr=${m.source.score},cor=${m.source.correct},` +
                `res='${m.source.result ?? ''}',lbl='${m.source.label ?? ''}',li=${m.source.listitem_id ?? '∅'}} ` +
                `tgt{pts=${m.target?.points ?? null},scr=${m.target?.score ?? null},cor=${m.target?.correct ?? null},` +
                `res='${m.target?.result ?? ''}',lbl='${m.target?.label ?? ''}',li=${m.target?.listitem_id ?? '∅'}}`
            );
        }

        for (const m of diff.mismatches) {
            lines.push(
                `⚠️ srcAID=${m.sourceAnswerId} ` +
                (m.targetAnswerId != null ? `tgtAID=${m.targetAnswerId}` : `tgtAID=∅`) +
                ` (QID ${m.questionId} / UID ${m.userId})` +
                ` | src pts=${m.source.points} scr=${m.source.score} cor=${m.source.correct}` +
                ` res='${m.source.result ?? ''}' lbl='${m.source.label ?? ''}' li=${m.source.listitem_id ?? '∅'}` +
                ` | tgt pts=${m.target?.points ?? null} scr=${m.target?.score ?? null} cor=${m.target?.correct ?? null}` +
                ` res='${m.target?.result ?? ''}' lbl='${m.target?.label ?? ''}' li=${m.target?.listitem_id ?? '∅'}`
            );
        }

        const txtPath = writeTextReport('./reports', 'verification-report', lines.join('\n'));
        const jsonPath = writeJsonReport('./reports', 'verification-summary', diff);
        console.log(`[Phase 3] Report:  ${txtPath}`);
        console.log(`[Phase 3] Summary: ${jsonPath}`);
    } finally {
        await Promise.allSettled([src.end(), tgt.end()]);
    }
    console.log('[Verify] Done.');
}

main().catch(e => { console.error(e); process.exit(1); });