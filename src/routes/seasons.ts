// src/routes/seasons.ts
import { Router } from "express";
import { pool } from "../db";

import { SeasonsRepo } from "../modules/seasons/seasons.repo";
import { SeasonsService } from "../modules/seasons/seasons.service";

// deps for betPage composition
import { BetsRepo } from "../modules/bets/bets.repo";
import { BetsService } from "../modules/bets/bets.service";
import { AnswersRepo } from "../modules/answers/answers.repo";
import { SolutionsRepo } from "../modules/solutions/solutions.repo";

// NEW: standings/progression delegates (classification service)
import * as classificationSvc from "../modules/classification/classification.service";
import { parseNumber } from "../utils/validators";
import { parseVirtualParam } from "../types/domain";

/**
 * Body-only contracts. No URL params. Snake_case request/response.
 * Endpoints:
 *  - POST /api/v1/seasons/list             → { seasons: SeasonDto[] }
 *  - POST /api/v1/seasons/leagues          → { season_id } → { season_id, leagues: LeagueDto[] }
 *  - POST /api/v1/seasons/calendar         → { season_id } → { season_id, calendar: CalendarItem[] }
 *  - POST /api/v1/seasons/bet_page         → { bet_id, user_id } → composite payload for “De 50 Vragen”
 *  - POST /api/v1/seasons/bet_group_totals → { bet_id, user_id } → { bet_id, user_id, groups: [...] }
 *
 * URL-param contracts (GET):
 *  - GET  /api/v1/seasons/:season_id/leagues/:league_id/virtual/:virtual/standings
 *       ? expand=season,league,user
 *       [&sequence=NN]
 *  - GET  /api/v1/seasons/:season_id/leagues/:league_id/virtual/:virtual/users/:user_id/progression
 */
const router = Router();

// Shared services (fifty removed; now inlined in SeasonsRepo)
const betsSvc = new BetsService(new BetsRepo(pool));
const answersRepo = new AnswersRepo(pool);
const solutionsRepo = new SolutionsRepo(pool);

// Seasons service with composition deps injected
const seasonsService = new SeasonsService(new SeasonsRepo(pool as any), {
    bets: betsSvc,
    answers: answersRepo,
    solutions: solutionsRepo,
});

// ---------------------- POST (body-driven) ----------------------

router.post("/list", async (_req, res, next) => {
    try {
        const seasons = await seasonsService.listSeasons();
        res.json({ seasons });
    } catch (e) {
        next(e);
    }
});

router.post("/leagues", async (req, res, next) => {
    try {
        const season_id = Number(req.body?.season_id);
        if (!Number.isFinite(season_id))
            return res.status(400).json({ error: "season_id is required" });
        const leagues = await seasonsService.listLeaguesForSeason(season_id);
        res.json({ season_id, leagues });
    } catch (e) {
        next(e);
    }
});

router.post("/calendar", async (req, res, next) => {
    try {
        const season_id = Number(req.body?.season_id);
        if (!Number.isFinite(season_id))
            return res.status(400).json({ error: "season_id is required" });
        const payload = await seasonsService.calendarForSeason(season_id);
        res.json(payload);
    } catch (e) {
        next(e);
    }
});

// ---- De 50 Vragen (bet + user) ----
router.post("/bet_page", async (req, res, next) => {
    try {
        const bet_id = Number(req.body?.bet_id);
        const user_id = Number(req.body?.user_id);
        if (!Number.isFinite(bet_id) || !Number.isFinite(user_id)) {
            return res
                .status(400)
                .json({ error: "bet_id and user_id are required" });
        }
        const dto = await seasonsService.betPage(bet_id, user_id);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

/** Optional: narrow totals endpoint if you want it */
router.post("/bet_group_totals", async (req, res, next) => {
    try {
        const bet_id = Number(req.body?.bet_id);
        const user_id = Number(req.body?.user_id);
        if (!Number.isFinite(bet_id) || !Number.isFinite(user_id)) {
            return res
                .status(400)
                .json({ error: "bet_id and user_id are required" });
        }
        const dto = await seasonsService.betGroupTotals(bet_id, user_id);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

// ---------------------- GET (URL-param) ----------------------
// Matches FE calls like:
//   /api/v1/seasons/2026/leagues/1/virtual/0/standings?expand=season,league,user
//   /api/v1/seasons/2026/leagues/1/virtual/0/standings?sequence=12&expand=season,league,user
router.get("/:season_id/leagues/:league_id/virtual/:virtual/standings", async (req, res) => {
    const season_id = parseNumber(req.params.season_id);
    const league_id = parseNumber(req.params.league_id);
    const isVirtual = parseVirtualParam(String(req.params.virtual));
    const expand = req.query.expand;
    const sequence = parseNumber(req.query.sequence);

    if (!season_id || !league_id) {
        return res
            .status(400)
            .json({ error: "season_id and league_id are required" });
    }

    try {
        if (sequence != null) {
            const result = await classificationSvc.standingsAt(
                season_id,
                league_id,
                sequence,
                isVirtual,
                expand
            );
            return res.json(result);
        } else {
            const result = await classificationSvc.current(
                season_id,
                league_id,
                isVirtual,
                expand
            );
            return res.json(result);
        }
    } catch (err) {
        console.error("Error fetching standings:", err);
        return res.status(500).json({ error: "Failed to fetch standings" });
    }
});

// GET user progression (sparkline)
//   /api/v1/seasons/:season_id/leagues/:league_id/virtual/:virtual/users/:user_id/progression
router.get(
    "/:season_id/leagues/:league_id/virtual/:virtual/users/:user_id/progression",
    async (req, res) => {
        const season_id = parseNumber(req.params.season_id);
        const league_id = parseNumber(req.params.league_id);
        const user_id = parseNumber(req.params.user_id);
        const isVirtual = parseVirtualParam(String(req.params.virtual));

        if (!season_id || !league_id || !user_id) {
            return res.status(400).json({
                error: "season_id, league_id, and user_id are required",
            });
        }

        try {
            const series = await classificationSvc.userProgression(
                season_id,
                league_id,
                user_id,
                isVirtual
            );
            return res.json(series);
        } catch (err) {
            console.error("Error fetching user progression:", err);
            return res.status(500).json({ error: "Failed to fetch user progression" });
        }
    }
);

export default router;