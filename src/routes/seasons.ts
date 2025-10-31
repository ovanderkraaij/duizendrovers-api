// src/routes/seasons.ts
import { Router } from "express";
import * as classificationSvc from "../modules/classification/classification.service";
import { parseNumber } from "../utils/validators";
import { parseVirtualParam } from "../types/domain";

import { pool } from "../db";
import { UsersRepo } from "../modules/users/users.repo";
import { UsersService } from "../modules/users/users.service";

import { SeasonsRepo } from "../modules/seasons/seasons.repo";
import { SeasonsService } from "../modules/seasons/seasons.service";

const router = Router();

const usersSvc   = new UsersService(new UsersRepo(pool));
const seasonsSvc = new SeasonsService(new SeasonsRepo(pool));

/**
 * GET /api/v1/seasons
 * Returns: [{ id, label, closed }]
 */
router.get("/", async (_req, res, next) => {
    try {
        const items = await seasonsSvc.listSeasons();
        res.json(items);
    } catch (e) {
        next(e);
    }
});

/**
 * GET /api/v1/seasons/:seasonId/leagues
 * Returns: [{ id, label, icon }]
 */
router.get("/:seasonId/leagues", async (req, res, next) => {
    try {
        const seasonId = parseNumber(req.params.seasonId);
        if (!seasonId) return res.status(400).json({ error: "Invalid seasonId" });

        const items = await seasonsSvc.listLeaguesForSeason(seasonId);
        res.json(items);
    } catch (e) {
        next(e);
    }
});

/**
 * GET /api/v1/seasons/:seasonId/leagues/:leagueId/virtual/:virtual/standings
 *   ?expand=season,league,user
 *   ?sequence=NN
 */
router.get("/:seasonId/leagues/:leagueId/virtual/:virtual/standings", async (req, res) => {
    const seasonId  = parseNumber(req.params.seasonId);
    const leagueId  = parseNumber(req.params.leagueId);
    const isVirtual = parseVirtualParam(String(req.params.virtual));
    const expand    = req.query.expand;
    const sequence  = parseNumber(req.query.sequence);

    if (!seasonId || !leagueId) {
        return res.status(400).json({ error: "seasonId and leagueId required" });
    }

    try {
        if (sequence != null) {
            const result = await classificationSvc.standingsAt(seasonId, leagueId, sequence, isVirtual, expand);
            return res.json(result);
        } else {
            const result = await classificationSvc.current(seasonId, leagueId, isVirtual, expand);
            return res.json(result);
        }
    } catch (err) {
        console.error("Error fetching standings:", err);
        return res.status(500).json({ error: "Failed to fetch standings" });
    }
});

/**
 * GET /api/v1/seasons/:seasonId/leagues/:leagueId/virtual/:virtual/users/:userId/progression
 */
router.get("/:seasonId/leagues/:leagueId/virtual/:virtual/users/:userId/progression", async (req, res) => {
    const seasonId  = parseNumber(req.params.seasonId);
    const leagueId  = parseNumber(req.params.leagueId);
    const userId    = parseNumber(req.params.userId);
    const isVirtual = parseVirtualParam(String(req.params.virtual));

    if (!seasonId || !leagueId || !userId) {
        return res.status(400).json({ error: "seasonId, leagueId and userId are required" });
    }

    try {
        const series = await classificationSvc.userProgression(seasonId, leagueId, userId, isVirtual);
        return res.json({ seasonId, leagueId, userId, virtual: isVirtual, series });
    } catch (err) {
        console.error("Error fetching user progression:", err);
        return res.status(500).json({ error: "Failed to fetch user progression" });
    }
});

/**
 * GET /api/v1/seasons/:seasonId/users
 */
router.get("/:seasonId/users", async (req, res, next) => {
    try {
        const seasonId = Number(req.params.seasonId);
        if (!Number.isFinite(seasonId)) return res.status(400).json({ error: "Invalid seasonId" });
        const dto = await usersSvc.listForSeason(seasonId);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

export default router;