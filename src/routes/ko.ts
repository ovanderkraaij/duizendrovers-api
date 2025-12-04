

// src/routes/ko.ts
import { Router } from "express";
import { pool } from "../db";
import { KoRepo } from "../modules/ko/ko.repo";
import { KoService } from "../modules/ko/ko.service";

const router = Router();
const repo = new KoRepo(pool);
const svc = new KoService(repo);

/**
 * POST /api/v1/ko/current
 *
 * Body: { season_id: number, user_id: number }
 *
 * Returns the KO payload describing:
 * - active KO bet (if any) for the season
 * - current open question (deadline in the future)
 * - user state (active / eliminated / not_participating)
 * - KO-specific flags on the question (deadline, winnow, closed, draw, draw_date, regex)
 */
router.post("/current", async (req, res, next) => {
    try {
        const seasonId = Number(req.body?.season_id);
        const userId = Number(req.body?.user_id);

        if (!Number.isFinite(seasonId) || !Number.isFinite(userId)) {
            return res.status(400).json({
                error: "season_id and user_id are required and must be numeric",
            });
        }

        const payload = await svc.getCurrentForUser(seasonId, userId);
        return res.json(payload);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/ko/submit
 *
 * Body:
 * {
 *   "ko_question_id": number,
 *   "user_id": number,
 *   "duel_id": string | null,
 *   "ko_list_item_id": number | null,
 *   "label": string | null
 * }
 *
 * Rules:
 * - Voorrondes: no duel → just insert the user's answer.
 * - Knockout phase: duel present → submitting user gets chosen list item,
 *   opponent automatically gets the other list item (posted=1, answered=NULL).
 */
router.post("/submit", async (req, res, next) => {
    try {
        const body = req.body ?? {};

        const ko_question_id = Number(body.ko_question_id);
        const user_id = Number(body.user_id);
        const duel_id =
            typeof body.duel_id === "string" ? (body.duel_id as string) : null;
        const ko_list_item_id =
            body.ko_list_item_id != null
                ? Number(body.ko_list_item_id)
                : null;
        const label =
            typeof body.label === "string" ? (body.label as string) : null;

        if (!Number.isFinite(ko_question_id) || !Number.isFinite(user_id)) {
            return res.status(400).json({
                error: "ko_question_id and user_id are required and must be numeric",
            });
        }

        await svc.submitKoAnswer({
            ko_question_id,
            user_id,
            duel_id,
            ko_list_item_id: ko_list_item_id,
            label,
        });

        return res.json({ ok: true });
    } catch (err) {
        if (err instanceof Error) {
            // Domain-level validation errors from KoService
            return res.status(400).json({ error: err.message });
        }
        return next(err);
    }
});

/**
 * POST /api/v1/ko/tournament
 *
 * Body: { season_id: number }
 *
 * Returns the full KO tournament payload for the active KO bet of the season:
 * - bet meta (id, label, post_id)
 * - all rounds (middle + knockout)
 * - answers + eliminated users per round
 * - duels (pairs) for knockout rounds
 */
router.post("/tournament", async (req, res, next) => {
    try {
        const seasonId = Number(req.body?.season_id);

        if (!Number.isFinite(seasonId)) {
            return res.status(400).json({
                error: "season_id is required and must be numeric",
            });
        }

        try {
            const payload = await svc.getTournament(seasonId);
            return res.json(payload);
        } catch (err) {
            if (
                err instanceof Error &&
                err.message === "No active KO bet for this season"
            ) {
                return res.status(404).json({ error: err.message });
            }
            return next(err);
        }
    } catch (err) {
        next(err);
    }
});

export default router;