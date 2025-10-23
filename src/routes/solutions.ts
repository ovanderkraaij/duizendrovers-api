// src/routes/solutions.ts
import { Router } from "express";
import { pool } from "../db";

import { SolutionsRepo } from "../modules/solutions/solutions.repo";
import { SolutionsService } from "../modules/solutions/solutions.service";
import { AnswersRepo } from "../modules/answers/answers.repo"; // ⬅ add

const router = Router();

const solutionsRepo = new SolutionsRepo(pool);
const answersRepo   = new AnswersRepo(pool);               // ⬅ add
const solutionsSvc  = new SolutionsService(solutionsRepo);

// POST /v1/solutions  — create/record a solution entry
router.post("/", async (req, res, next) => {
    try {
        // Expect body: { questionId, type, payload: {...} }
        const result = await solutionsSvc.setSolution(req.body);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
});

// POST /v1/solutions/:betId/apply  — apply solutions to mark correct + set score=points
router.post("/:betId/apply", async (req, res, next) => {
    try {
        const betId = Number(req.params.betId);
        if (!Number.isFinite(betId)) return res.status(400).json({ error: "Invalid betId" });
        await solutionsSvc.markCorrectAndScore(betId);
        res.status(200).json({ ok: true });
    } catch (err) {
        next(err);
    }
});

export default router;