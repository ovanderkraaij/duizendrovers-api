//src/routes/bets.ts
import { Router } from "express";
import { pool } from "../db";
import { BetsRepo } from "../modules/bets/bets.repo";
import { BetsService } from "../modules/bets/bets.service";

const router = Router();
const svc = new BetsService(new BetsRepo(pool));

router.get("/:betId/questions", async (req, res, next) => {
    try {
        const betId = Number(req.params.betId);
        if (!Number.isFinite(betId)) return res.status(400).json({ error: "Invalid betId" });
        const dto = await svc.getBetQuestions(betId);
        res.json(dto);
    } catch (e) { next(e); }
});

export default router;


