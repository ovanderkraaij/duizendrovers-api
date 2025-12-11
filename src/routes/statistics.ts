// src/routes/statistics.ts
import { Router } from "express";
import { pool } from "../db";

import {
    type BullseyeRequestDto,
    type BullseyeStatsDto,
    type StatisticsPageRequestDto,
    type StatsPageDto,
    type MedalsRequestDto,
    type MedalsPageDto,
    type PalmaresRequestDto,
    type PalmaresPageDto,
} from "../modules/statistics/statistics.types";

import { StatisticsRepo } from "../modules/statistics/statistics.repo";
import { StatisticsService } from "../modules/statistics/statistics.service";
import { SolutionsRepo } from "../modules/solutions/solutions.repo";

const router = Router();

// --- Instantiate repos ---
const statsRepo = new StatisticsRepo(pool);
const solutionsRepo = new SolutionsRepo(pool);

// --- Inject BOTH repos into the service ---
const statsSvc = new StatisticsService(statsRepo, solutionsRepo);

/**
 * POST /api/v1/statistics/page
 *
 * Body:
 * {
 *   "stats_page": "total_score" | "eagles" | "total_points" | "ups_missed" | "longest_time" | "most_efficient" | "on_throne"
 *   "user_id": number | null,
 *   "is_virtual": boolean
 * }
 */
router.post("/page", async (req, res, next) => {
    try {
        const body = req.body as Partial<StatisticsPageRequestDto>;

        const statsPage =
            (body.stats_page ?? "total_score") as StatisticsPageRequestDto["stats_page"];

        const allowedPages: StatisticsPageRequestDto["stats_page"][] = [
            "total_score",
            "eagles",
            "total_points",
            "ups_missed",
            "longest_time",
            "most_efficient",
            "on_throne",
        ];

        if (!allowedPages.includes(statsPage)) {
            return res.status(400).json({
                error: `Unsupported stats_page: ${statsPage}`,
            });
        }

        const dto: StatisticsPageRequestDto = {
            stats_page: statsPage,
            user_id:
                typeof body.user_id === "number"
                    ? body.user_id
                    : body.user_id ?? null,
            is_virtual: Boolean(body.is_virtual),
        };

        const page: StatsPageDto = await statsSvc.getStatisticsPage(dto);
        return res.json(page);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/statistics/bullseyes
 *
 * Body:
 * {
 *   "user_id": number | null,
 *   "is_virtual": boolean
 * }
 *
 * Response: BullseyeStatsDto
 */
router.post("/bullseyes", async (req, res, next) => {
    try {
        const body = req.body as Partial<BullseyeRequestDto>;

        const dto: BullseyeRequestDto = {
            user_id:
                typeof body.user_id === "number"
                    ? body.user_id
                    : body.user_id ?? null,
            is_virtual: Boolean(body.is_virtual),
        };

        const payload: BullseyeStatsDto = await statsSvc.getBullseyeStats(dto);
        return res.json(payload);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/statistics/medals
 *
 * Body:
 * {
 *   "user_id": number | null,
 *   "is_virtual": boolean
 * }
 *
 * Response: MedalsPageDto
 */
router.post("/medals", async (req, res, next) => {
    try {
        const body = req.body as Partial<MedalsRequestDto>;

        const dto: MedalsRequestDto = {
            user_id:
                typeof body.user_id === "number"
                    ? body.user_id
                    : body.user_id ?? null,
            is_virtual: Boolean(body.is_virtual),
        };

        const payload: MedalsPageDto = await statsSvc.getMedalsPage(dto);
        return res.json(payload);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/statistics/palmares
 *
 * Body:
 * {
 *   "user_id": number | null,
 *   "is_virtual": boolean
 * }
 *
 * Response: PalmaresPageDto
 */
router.post("/palmares", async (req, res, next) => {
    try {
        const body = req.body as Partial<PalmaresRequestDto>;

        const dto: PalmaresRequestDto = {
            user_id:
                typeof body.user_id === "number"
                    ? body.user_id
                    : body.user_id ?? null,
            is_virtual: Boolean(body.is_virtual),
        };

        const payload: PalmaresPageDto = await statsSvc.getPalmaresPage(dto);
        return res.json(payload);
    } catch (err) {
        next(err);
    }
});

export default router;