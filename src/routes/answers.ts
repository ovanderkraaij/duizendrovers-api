import { Router } from "express";
import { pool } from "../db";

import { AnswersRepo } from "../modules/answers/answers.repo";
import { QuestionsRepo } from "../modules/questions/questions.repo";
import { PreclassificationRepo } from "../modules/preclassification/preclassification.repo";
import { SolutionsRepo } from "../modules/solutions/solutions.repo";

import { AnswerService } from "../modules/answers/answers.service";
import { PreclassificationService } from "../modules/preclassification/preclassification.service";
import { SolutionsService } from "../modules/solutions/solutions.service";

const router = Router();

const answersRepo = new AnswersRepo(pool);
const questionsRepo = new QuestionsRepo(pool);
const preRepo      = new PreclassificationRepo(pool);
const solsRepo     = new SolutionsRepo(pool);

const answerSvc = new AnswerService(answersRepo, questionsRepo);
const preSvc    = new PreclassificationService(preRepo);
const solsSvc   = new SolutionsService(solsRepo);

const AUTO_APPLY_SOLUTIONS = process.env.AUTO_APPLY_SOLUTIONS === "1";

/**
 * GET /api/v1/answers/:betId?userId=NN
 * Returns existing answers meta for a bet/user.
 */
router.get("/:betId", async (req, res, next) => {
    try {
        const betId  = Number(req.params.betId);
        const userId = Number(req.query.userId);
        if (!Number.isFinite(betId) || !Number.isFinite(userId)) {
            return res.status(400).json({ error: "betId and userId required" });
        }
        const dto = await answerSvc.getExistingForBetUser(betId, userId);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

/**
 * POST /api/v1/answers
 * Body:
 *  { betId, userId, submissions: [ {questionId, listItemId} | {questionId, label}, ... ] }
 */
router.post("/", async (req, res, next) => {
    try {
        const betId       = Number(req.body?.betId);
        const userId      = Number(req.body?.userId);
        const submissions = Array.isArray(req.body?.submissions) ? req.body.submissions : [];

        const out = await answerSvc.submitBatchRaw({ betId, userId, submissions });

        if (Number.isFinite(betId)) {
            // keep existing BE side-effects exactly as before
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

router.post("/status", async (req, res, next) => {
    try {
        const bet_id  = Number(req.body?.bet_id);
        const user_id = Number(req.body?.user_id);
        if (!Number.isFinite(bet_id) || !Number.isFinite(user_id)) {
            return res.status(400).json({ error: "bet_id and user_id are required" });
        }

        const dto = await answerSvc.getExistingForBetUser(bet_id, user_id);
        // Return only what the FE needs for routing; keep snake_case from DB semantics.
        return res.json({
            bet_id: dto.betId,
            user_id: dto.userId,
            has_submitted: dto.hasSubmitted,
        });
    } catch (e) {
        next(e);
    }
});
export default router;