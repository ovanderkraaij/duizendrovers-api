// src/routes/seasons.ts
import { Router } from "express";
import * as svc from "../modules/classification/classification.service";
import { parseNumber } from "../utils/validators";
import { parseVirtualParam } from "../types/domain";

const router = Router();

/**
 * GET /api/v1/seasons/:seasonId/leagues/:leagueId/virtual/:virtual/standings
 *   ?expand=season,league,user
 *   ?sequence=NN   (optional: latest if absent, within chosen dataset)
 */
router.get("/:seasonId/leagues/:leagueId/virtual/:virtual/standings", async (req, res) => {
    const seasonId = parseNumber(req.params.seasonId);
    const leagueId = parseNumber(req.params.leagueId);
    const isVirtual = parseVirtualParam(String(req.params.virtual));
    const expand = req.query.expand;
    const sequence = parseNumber(req.query.sequence);

    if (!seasonId || !leagueId) {
        return res.status(400).json({ error: "seasonId and leagueId required" });
    }

    try {
        if (sequence != null) {
            const result = await svc.standingsAt(seasonId, leagueId, sequence, isVirtual, expand);
            return res.json(result);
        } else {
            const result = await svc.current(seasonId, leagueId, isVirtual, expand);
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
    const seasonId = parseNumber(req.params.seasonId);
    const leagueId = parseNumber(req.params.leagueId);
    const userId = parseNumber(req.params.userId);
    const isVirtual = parseVirtualParam(String(req.params.virtual));

    if (!seasonId || !leagueId || !userId) {
        return res.status(400).json({ error: "seasonId, leagueId and userId are required" });
    }

    try {
        const series = await svc.userProgression(seasonId, leagueId, userId, isVirtual);
        // 👇 return an object so the FE can parse via getJson()
        return res.json({ seasonId, leagueId, userId, virtual: isVirtual, series });
    } catch (err) {
        console.error("Error fetching user progression:", err);
        return res.status(500).json({ error: "Failed to fetch user progression" });
    }
});

export default router;