// src/modules/preclassification/preclassifcation.service.ts
import { PreclassificationRepo } from './preclassification.repo';

function formatInTimeZoneISO(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
        .formatToParts(date)
        .reduce<Record<string, string>>((acc, p) => {
            if (p.type !== 'literal') acc[p.type] = p.value;
            return acc;
        }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export class PreclassificationService {
    constructor(private repo: PreclassificationRepo) {}

    async rebuild(betId: number, now: Date) {
        const keep = await this.repo.getMaxSequence(betId);
        const newSeq = (keep ?? 1) + 1;
        await this.repo.deleteOlderSequences(betId, keep);

        const rows = await this.repo.aggregateTotals(betId);
        let seed = 1;
        let lastPoints: number | null = null;
        const insertion = formatInTimeZoneISO(now, 'Europe/Amsterdam');

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (lastPoints != null && r.totalpoints < lastPoints) seed = i + 1;
            await this.repo.insertRow(betId, r.userId, r.totalpoints, newSeq, seed, insertion);
            lastPoints = r.totalpoints;
        }
        return { sequence: newSeq, count: rows.length };
    }
    async list(bet_id: number) {
        const pair = await this.repo.get_latest_two_sequences(bet_id);
        const latest = pair.latest;
        const previous = pair.previous;

        if (!latest) {
            return {
                bet_id,
                sequence: null,
                previous_sequence: null,
                standings: [] as any[],
            };
        }

        const latest_rows = await this.repo.get_rows_for_sequence(bet_id, latest);
        const prev_rows   = previous ? await this.repo.get_rows_for_sequence(bet_id, previous) : [];
        const prev_by_user = new Map<number, { seed: number }>();
        for (const r of prev_rows) prev_by_user.set(r.user_id, { seed: r.seed });

        const standings = latest_rows
            .map(r => {
                const prev_seed = prev_by_user.get(r.user_id)?.seed ?? null;
                const movement = (prev_seed == null) ? 0 : (prev_seed - r.seed); // up is positive
                return {
                    user_id: r.user_id,
                    points: r.points,
                    seed: r.seed,
                    previous_seed: prev_seed,
                    movement,
                };
            })
            .sort((a, b) => a.seed - b.seed);

        return {
            bet_id,
            sequence: latest,
            previous_sequence: previous,
            standings,
        };
    }
}

