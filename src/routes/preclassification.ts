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

export default router;