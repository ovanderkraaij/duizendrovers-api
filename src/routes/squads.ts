// src/routes/squads.ts
import { Router } from "express";
import { parseNumber } from "../utils/validators";
import { parseVirtualParam } from "../types/domain";
import * as svc from "../modules/squads/squads.service";

const router = Router();

/**
 * Path-param style ONLY (final):
 *
 * GET /api/v1/squads/seasons/:seasonId/virtual/:virtual/standings
 *   - :seasonId = "current" | YYYY
 *   - :virtual  = "0" | "1"
 */
router.get("/seasons/:seasonId/virtual/:virtual/standings", async (req, res) => {
    try {
        const seasonIdParam = req.params.seasonId;
        const seasonId = seasonIdParam === "current" ? "current" : parseNumber(seasonIdParam);
        const isVirtual = parseVirtualParam(String(req.params.virtual ?? "0"));

        const data = await svc.getSquadStandings(seasonId as any, isVirtual);
        res.json(data);
    } catch (err) {
        console.error("Error in /squads/seasons/:seasonId/virtual/:virtual/standings:", err);
        res.status(500).json({ error: "Failed to compute squad standings" });
    }
});

/**
 * Path-param style ONLY (final):
 *
 * GET /api/v1/squads/seasons/:seasonId/virtual/:virtual/users/:userId/mine
 *   - :seasonId = "current" | YYYY
 *   - :virtual  = "0" | "1"
 *   - :userId   = number
 */
router.get("/seasons/:seasonId/virtual/:virtual/users/:userId/mine", async (req, res) => {
    try {
        const seasonIdParam = req.params.seasonId;
        const seasonId = seasonIdParam === "current" ? "current" : parseNumber(seasonIdParam);
        const isVirtual = parseVirtualParam(String(req.params.virtual ?? "0"));
        const userId = parseNumber(req.params.userId);
        if (!userId) return res.status(400).json({ error: "userId is required" });

        const data = await svc.getMySquadStanding(seasonId as any, isVirtual, userId);
        res.json(data);
    } catch (err) {
        console.error("Error in /squads/seasons/:seasonId/virtual/:virtual/users/:userId/mine:", err);
        res.status(500).json({ error: "Failed to compute user's squad standing" });
    }
});

export default router;