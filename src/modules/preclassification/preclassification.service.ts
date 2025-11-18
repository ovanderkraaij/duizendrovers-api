// src/modules/preclassification/preclassification.service.ts
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

    /**
     * Latest pre-classification with movement and optional nested user info,
     * plus submitted/participants counts and not_submitted details for the subtitle panel.
     */
    async list(bet_id: number) {
        const standings = await this.repo.fetchLatestWithMovementAndUser(bet_id);
        const latest = await this.repo.getMaxSequence(bet_id);
        const previous = latest && latest > 1 ? latest - 1 : null;
        const bet_title = await this.repo.getBetLabel(bet_id);

        // NEW: counts + not_submitted
        const season_id = await this.repo.getBetSeasonId(bet_id);
        let submitted_count = 0;
        let participants_total = 0;
        let not_submitted: Array<{
            user_id: number;
            firstname: string | null;
            infix: string | null;
            lastname: string | null;
            display_name: string;
            is_captain: boolean;
            squad: { abbr: string | null; color: string | null };
        }> = [];

        if (season_id) {
            const [participants, submittedSet, squadMap] = await Promise.all([
                this.repo.listSeasonParticipants(season_id),
                this.repo.listSubmittedUserIdsForBet(bet_id),
                this.repo.mapUserSquadInfo(season_id),
            ]);

            participants_total = participants.length;
            submitted_count = Array.from(submittedSet).length;

            const ns = participants.filter(p => !submittedSet.has(p.user_id)).map(p => {
                const sq = squadMap.get(p.user_id);
                const display = [p.firstname, p.infix, p.lastname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                return {
                    user_id: p.user_id,
                    firstname: p.firstname,
                    infix: p.infix,
                    lastname: p.lastname,
                    display_name: display || `User ${p.user_id}`,
                    is_captain: sq?.is_captain ?? false,
                    squad: { abbr: sq?.abbr ?? null, color: sq?.bg ?? null, fg: sq?.fg ?? null },                };
            });

            // FE can sort, but return a sensible default (A–Z)
            ns.sort((a, b) => a.display_name.localeCompare(b.display_name, 'nl', { sensitivity: 'base' }));
            not_submitted = ns;
        }

        return {
            bet_id,
            bet_title,
            sequence: latest ?? null,
            previous_sequence: previous,
            standings,
            submitted_count,
            participants_total,
            not_submitted,
        };
    }
}