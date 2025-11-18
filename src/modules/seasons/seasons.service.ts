// src/modules/seasons/seasons.service.ts
import type { SeasonsRepo, SeasonRow, LeagueRow } from "./seasons.repo";
import { getCalendar, getCalendarForSeason, type CalendarItem } from "../calendar/calendar.service";

// cross-module deps used only for the Calendar/bet composition
import { BetsService } from "../bets/bets.service";
import { AnswersRepo } from "../answers/answers.repo";
import { SolutionsRepo } from "../solutions/solutions.repo";
import { pool } from "../../db";

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

type BetPageAnswersMap = Record<
    string,
    { label: string; list_item_id: number | null; posted: boolean; result: string | null }
    >;

type BetPageSolutionsMap = Record<
    string,
    { result: string | null; list_item_id: number | null }
    >;

export class SeasonsService {
    constructor(
        private repo: SeasonsRepo,
        private deps?: {
            bets?: BetsService;
            answers?: AnswersRepo;
            solutions?: SolutionsRepo;
        }
    ) {}

    // --- Seasons core ---
    async listSeasons(): Promise<SeasonDto[]> {
        const rows = await this.repo.getSeasons();
        return rows.map(this.mapSeason);
    }

    async listLeaguesForSeason(seasonId: number): Promise<LeagueDto[]> {
        const rows = await this.repo.getLeaguesBySeason(seasonId);
        return rows.map(this.mapLeague);
    }

    // --- Calendar (centralized in calendar module) ---
    async calendar(): Promise<CalendarItem[]> {
        return getCalendar();
    }

    async calendarForSeason(seasonId: number): Promise<{ season_id: number; calendar: CalendarItem[] }> {
        const calendar = await getCalendarForSeason(seasonId);
        return { season_id: seasonId, calendar };
    }

    // --- “De 50 Vragen” page composer (bet + user) ---
    /**
     * Returns:
     * {
     *   meta: {
     *     bet_id, title, active,
     *     deadline_utc, expected_utc, effective_deadline_utc
     *   },
     *   questions: [...],
     *   answers: {...},
     *   solutions: {...},
     *   group_totals: {...}
     * }
     */
    async betPage(betId: number, userId: number) {
        if (!this.deps?.bets || !this.deps?.answers || !this.deps?.solutions) {
            throw new Error("SeasonsService missing dependencies for betPage()");
        }

        // 1) Questions (rich schema)
        const qDto = await this.deps.bets.getBetQuestions(betId);

        // 2) Posted answers for this bet+user
        const posted = await this.deps.answers.getPostedForBetUser(betId, userId);
        const answersByQid: BetPageAnswersMap = {};
        for (const r of posted as any[]) {
            const qid = String(Number(r.questionId));
            answersByQid[qid] = {
                label: String(r.label ?? ""),
                list_item_id: r.listItemId != null ? Number(r.listItemId) : null,
                posted: true,
                result: r.result != null ? String(r.result) : null,
            };
        }

        // 3) Solutions for all qids in this bet
        const qids = qDto.questions.map((q: any) => q.id);
        const solRows = await this.deps.solutions.getSolutionsForQids(qids);
        const solutionsByQid: BetPageSolutionsMap = {};
        for (const s of solRows as any[]) {
            const qid = String(Number(s.question_id));
            solutionsByQid[qid] = {
                result: s.result != null ? String(s.result) : null,
                list_item_id: s.listitem_id != null ? Number(s.listitem_id) : null,
            };
        }

        // 4) Group totals
        const groups = await this.repo.getGroupTotals(betId, userId);
        let totalValue = 0,
            totalScore = 0;
        for (const g of groups) {
            totalValue += Number(g.value || 0);
            totalScore += Number(g.score || 0);
        }

        // 5) Meta enrichment (UTC Z)
        const [betRow] = await pool.query<any[]>(
            "SELECT deadline, expected FROM bet WHERE id = ? LIMIT 1",
            [betId]
        );
        const row = betRow?.[0];
        const deadline_utc = this.toUtcZ(row?.deadline ?? null);
        const expected_utc = this.toUtcZ(row?.expected ?? null);
        const effective_deadline_utc = deadline_utc ?? expected_utc ?? null;

        const meta = {
            bet_id: qDto.betId,
            title: qDto.betTitle ?? `Bet ${qDto.betId}`,
            active: true,
            deadline_utc,
            expected_utc,
            effective_deadline_utc,
        };

        return {
            meta,
            questions: qDto.questions,
            answers: answersByQid,
            solutions: solutionsByQid,
            group_totals: {
                groups,
                total_value: totalValue,
                total_score: totalScore,
            },
        };
    }

    /** Narrow endpoint for totals only. */
    async betGroupTotals(betId: number, userId: number) {
        const groups = await this.repo.getGroupTotals(betId, userId);
        return { bet_id: betId, user_id: userId, groups };
    }

    // ---- helpers ----
    private toUtcZ(input: string | Date | null): string | null {
        if (!input) return null;
        const d = new Date(input);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    }

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