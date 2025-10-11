// src/modules/classification/classification.routes.ts
import { Router } from "express";
import { parseNumber, oneOf } from "../../utils/validators";
import { parsePage, parsePageSize } from "../../utils/pagination";
import * as svc from "./classification.service";
import { parseVirtualParam } from "../../types/domain";

const router = Router();

/**
 * GET /api/v1/seasons/:season_id/leagues/:league_id/virtual/:virtual/standings
 *   ?expand=season,league,user
 *   ?sequence=NN         (optional: if omitted, returns latest within that dataset)
 */
router.get("/seasons/:season_id/leagues/:league_id/virtual/:virtual/standings", async (req, res) => {
  const season_id = parseNumber(req.params.season_id);
  const league_id = parseNumber(req.params.league_id);
  const isVirtual = parseVirtualParam(String(req.params.virtual));
  const expand = req.query.expand;
  const sequence = parseNumber(req.query.sequence);

  if (!season_id || !league_id) {
    return res.status(400).json({ error: "season_id and league_id are required" });
  }

  try {
    if (sequence != null) {
      const result = await svc.standingsAt(season_id, league_id, sequence, isVirtual, expand);
      res.json(result);
    } else {
      const result = await svc.current(season_id, league_id, isVirtual, expand);
      res.json(result);
    }
  } catch (err) {
    console.error("Error fetching standings:", err);
    res.status(500).json({ error: "Failed to fetch standings" });
  }
});

/**
 * GET /api/v1/classifications/user/:user_id/virtual/:virtual
 *   ?season_id=YYYY&league_id=L
 */
router.get("/classifications/user/:user_id/virtual/:virtual", async (req, res) => {
  const user_id = parseNumber(req.params.user_id);
  const isVirtual = parseVirtualParam(String(req.params.virtual));
  const season_id = parseNumber(req.query.season_id);
  const league_id = parseNumber(req.query.league_id);

  if (!user_id || !season_id || !league_id) {
    return res.status(400).json({ error: "user_id (path), season_id and league_id (query) are required" });
  }
  try {
    const series = await svc.userProgression(season_id, league_id, user_id, isVirtual);
    res.json(series);
  } catch (err) {
    console.error("Error fetching user progression:", err);
    res.status(500).json({ error: "Failed to fetch user progression" });
  }
});

/**
 * (Optional) Paged listing, filtered by dataset
 * GET /api/v1/classifications/virtual/:virtual
 */
router.get("/classifications/virtual/:virtual", async (req, res) => {
  const isVirtual = parseVirtualParam(String(req.params.virtual));
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const expand = req.query.expand;
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy : undefined;
    const orderDir = oneOf(req.query.orderDir, ["asc", "desc"] as const, "asc");

    const season_id = parseNumber(req.query.season_id);
    const league_id = parseNumber(req.query.league_id);
    const user_id = parseNumber(req.query.user_id);
    const question_id = parseNumber(req.query.question_id);

    const result = await svc.list({
      page, pageSize, search, orderBy, orderDir,
      season_id, league_id, user_id, question_id,
      virtual: isVirtual
    });
    res.json(result);
  } catch (err) {
    console.error("Error listing classifications:", err);
    res.status(500).json({ error: "Failed to list classifications" });
  }
});

export default router;