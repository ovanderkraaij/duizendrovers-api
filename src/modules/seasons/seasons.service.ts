// src/modules/seasons/seasons.service.ts
import type { SeasonsRepo, SeasonRow, LeagueRow } from "./seasons.repo";

export interface SeasonDto {
    id: number;
    label: string;
    closed: boolean; // normalized
}

export interface LeagueDto {
    id: number;
    label: string;
    icon: string;
}

export class SeasonsService {
    constructor(private repo: SeasonsRepo) {}

    async listSeasons(): Promise<SeasonDto[]> {
        const rows = await this.repo.getSeasons();
        return rows.map(this.mapSeason);
    }

    async listLeaguesForSeason(seasonId: number): Promise<LeagueDto[]> {
        const rows = await this.repo.getLeaguesBySeason(seasonId);
        return rows.map(this.mapLeague);
    }

    // ---- mappers ----
    private mapSeason(r: SeasonRow): SeasonDto {
        return {
            id: Number(r.id),
            label: String(r.label ?? ""),
            closed: String(r.closed ?? "") === "1",
        };
    }

    private mapLeague(r: LeagueRow): LeagueDto {
        return {
            id: Number(r.id),
            label: String(r.label ?? ""),
            icon: String(r.icon ?? ""),
        };
    }
}