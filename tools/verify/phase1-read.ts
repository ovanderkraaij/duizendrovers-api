//tools/verify/phase1-read.ts
import type { Pool } from 'mysql2/promise';

export interface SourceAnswerRow {
    id: number;
    question_id: number;
    user_id: number;
    result: string | null;
    listitem_id: number | null;
    points: number | null;
    score: number | null;
    correct: number | null;
    posted: number | null;
}

export interface SourceSnapshot {
    seasonId: number;
    answers: SourceAnswerRow[];
}

export async function readBaselineFromSource(seasonId: number, src: Pool): Promise<SourceSnapshot> {
    const [rows] = await src.query<any[]>(
        `
    SELECT a.id, a.question_id, a.user_id, a.result, a.listitem_id,
           a.points, a.score, a.correct, a.posted
    FROM answer a
    JOIN question q ON q.id = a.question_id
    JOIN bet b ON b.id = q.bet_id
    WHERE b.season_id = ?
    ORDER BY a.id
    `,
        [seasonId]
    );

    const answers: SourceAnswerRow[] = rows.map(r => ({
        id: Number(r.id),
        question_id: Number(r.question_id),
        user_id: Number(r.user_id),
        result: r.result ?? null,
        listitem_id: r.listitem_id == null ? null : Number(r.listitem_id),
        points: r.points == null ? null : Number(r.points),
        score: r.score == null ? null : Number(r.score),
        correct: r.correct == null ? null : Number(r.correct),
        posted: r.posted == null ? null : Number(r.posted),
    }));

    return { seasonId, answers };
}