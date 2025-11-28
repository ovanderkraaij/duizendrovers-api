// src/routes/bets.ts
import { Router } from "express";
import { pool } from "../db";
import { BetsRepo } from "../modules/bets/bets.repo";
import { BetsService } from "../modules/bets/bets.service";
import { AnswersRepo } from "../modules/answers/answers.repo";
import { SolutionsRepo } from "../modules/solutions/solutions.repo";

const router = Router();
const svc = new BetsService(
    new BetsRepo(pool),
    new AnswersRepo(pool),
    new SolutionsRepo(pool)
);

router.get("/:betId/questions", async (req, res, next) => {
    try {
        const betId = Number(req.params.betId);
        if (!Number.isFinite(betId)) {
            return res.status(400).json({ error: "Invalid betId" });
        }
        const dto = await svc.getBetQuestions(betId);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

/**
 * Historical stats for bets with the same label as the given bet.
 * Body: { bet_id: number, user_id?: number }
 *
 * - bet_id  : the reference bet
 * - user_id : optional, used to compute personal scores ("your_score")
 */
router.post("/history", async (req, res, next) => {
    try {
        const { bet_id, user_id } = req.body ?? {};
        const betId = Number(bet_id);
        if (!Number.isFinite(betId)) {
            return res.status(400).json({ error: "Invalid bet_id" });
        }

        let userId: number | undefined;
        if (user_id != null) {
            const n = Number(user_id);
            if (Number.isFinite(n)) {
                userId = n;
            }
        }

        const dto = await svc.getBetHistoryByName(betId, userId);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

/**
 * Bundles + per-question metadata + per-user predictions for a bet.
 *
 * Body: { bet_id: number, user_id: number }
 *
 * Returns exactly the agreed DTO:
 * {
 *   "bet_id": 2025030,
 *   "label": "Voetbalcompetities",
 *   "deadline": "2025-06-30T19:45:00.000Z",
 *   "bundles": [...]
 * }
 */
router.post("/bundles", async (req, res, next) => {
    try {
        const { bet_id, user_id } = req.body ?? {};
        const betId = Number(bet_id);
        const userId = Number(user_id);

        if (!Number.isFinite(betId)) {
            return res.status(400).json({ error: "Invalid bet_id" });
        }
        if (!Number.isFinite(userId)) {
            return res.status(400).json({ error: "Invalid user_id" });
        }

        const dto = await svc.getBetBundles(betId, userId);
        res.json(dto);
    } catch (e) {
        next(e);
    }
});

export default router;