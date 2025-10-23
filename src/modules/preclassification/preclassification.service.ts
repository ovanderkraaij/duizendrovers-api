// src/modules/preclassification/service.ts
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
}