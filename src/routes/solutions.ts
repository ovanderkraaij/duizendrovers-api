// src/routes/solutions.ts
import { Router } from "express";
import { pool } from "../db";

import { SolutionsRepo } from "../modules/solutions/solutions.repo";
import { SolutionsService } from "../modules/solutions/solutions.service";
import { AnswersRepo } from "../modules/answers/answers.repo";
import {QuestionsRepo} from "../modules/questions/questions.repo"; // ⬅ add

const router = Router();

const solutionsRepo = new SolutionsRepo(pool);
const answersRepo   = new AnswersRepo(pool);
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

router.get("/bet/:betId", async (req, res, next) => {
    try {
        const betId = Number(req.params.betId);
        if (!Number.isFinite(betId)) return res.status(400).json({ error: "Invalid betId" });

        const qRepo = new QuestionsRepo(pool);
        const solsRepo = new SolutionsRepo(pool);

        // Get all qids for this bet (minimal shape is enough)
        const qids = (await qRepo.getByBetIdWithResultTypes(betId)).map(q => q.id);
        if (qids.length === 0) return res.json({ bet_id: betId, items: [] });

        const rows = await solsRepo.getSolutionsForQids(qids);
        const items = (rows as any[]).map(r => ({
            question_id: Number(r.question_id),
            result: r.result != null ? String(r.result) : null,
            listitem_id: r.listitem_id != null ? Number(r.listitem_id) : null,
        }));

        res.json({ bet_id: betId, items });
    } catch (err) {
        next(err);
    }
});

export default router;