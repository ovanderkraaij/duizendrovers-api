// src/routes/preclassification.ts
import { Router } from "express";
import { pool } from "../db";

import { PreclassificationRepo } from "../modules/preclassification/preclassification.repo";
import { PreclassificationService } from "../modules/preclassification/preclassification.service";

const router = Router();

// Wire repo + service
const preRepo = new PreclassificationRepo(pool);
const preSvc  = new PreclassificationService(preRepo);

// POST /v1/preclassification/:betId/rebuild
router.post("/:betId/rebuild", async (req, res, next) => {
    try {
        const betId = Number(req.params.betId);
        if (isNaN(betId)) {
            return res.status(400).json({ error: "Invalid betId" });
        }

        const result = await preSvc.rebuild(betId, new Date());
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
});

// POST /v1/preclassification/list   { bet_id }
router.post("/list", async (req, res, next) => {
    try {
        const bet_id = Number(req.body?.bet_id);
        if (!Number.isFinite(bet_id)) {
            return res.status(400).json({ error: "bet_id required" });
        }
        const dto = await preSvc.list(bet_id);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

export default router;