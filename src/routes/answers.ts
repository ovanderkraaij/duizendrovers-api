// src/routes/answers.ts
import { Router } from "express";
import { pool } from "../db";

import { AnswersRepo } from "../modules/answers/answers.repo";
import { QuestionsRepo } from "../modules/questions/questions.repo";
import { PreclassificationRepo } from "../modules/preclassification/preclassification.repo";
import { SolutionsRepo } from "../modules/solutions/solutions.repo";
import { SolutionsService } from "../modules/solutions/solutions.service";

import { AnswerService } from "../modules/answers/answers.service";
import { PreclassificationService } from "../modules/preclassification/preclassification.service";

const router = Router();

const answersRepo = new AnswersRepo(pool);
const questionsRepo = new QuestionsRepo(pool);
const preRepo      = new PreclassificationRepo(pool);
const solsRepo     = new SolutionsRepo(pool);

const answerSvc = new AnswerService(answersRepo, questionsRepo);
const preSvc    = new PreclassificationService(preRepo);
const solsSvc   = new SolutionsService(solsRepo);

const AUTO_APPLY_SOLUTIONS = process.env.AUTO_APPLY_SOLUTIONS === "1";

// POST /v1/answers
// Single canonical shape:
// { betId, userId, submissions: [ {questionId, listItemId} | {questionId, label}, ... ] }
router.post("/", async (req, res, next) => {
    try {
        const betId = Number(req.body?.betId);
        const userId = Number(req.body?.userId);
        const submissions = Array.isArray(req.body?.submissions) ? req.body.submissions : [];

        const out = await answerSvc.submitBatchRaw({ betId, userId, submissions });

        if (Number.isFinite(betId)) {
            await preSvc.rebuild(betId, new Date());
            if (AUTO_APPLY_SOLUTIONS) {
                await solsSvc.markCorrectAndScore(betId);
            }
        }

        res.status(201).json(out);
    } catch (err) {
        next(err);
    }
});

export default router;