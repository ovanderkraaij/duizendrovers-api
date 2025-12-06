// src/routes/statistics.ts
import { Router } from "express";
import { pool } from "../db";

import {
    type StatisticsPageRequestDto,
    type StatsPageDto,
} from "../modules/statistics/statistics.types";
import { StatisticsRepo } from "../modules/statistics/statistics.repo";
import { StatisticsService } from "../modules/statistics/statistics.service";

const router = Router();

// Wire repo + service (same pattern as preclassification, squads, etc.)
const statsRepo = new StatisticsRepo(pool);
const statsSvc = new StatisticsService(statsRepo);

/**
 * POST /api/v1/statistics/page
 *
 * Body:
 * {
 *   "stats_page": "total_score" | "eagles" | "total_points" | "ups_missed" | "longest_time" // optional, defaults to "total_score"
 *   "user_id": 35 | null,
 *   "is_virtual": false
 * }
 *
 * Note:
 * - "eagles" shares the payload shape with "total_score" but uses weighted seasons.
 * - "total_points" shares the payload shape but uses integer points.
 * - "ups_missed" and "longest_time" share the payload shape but:
 *     • do NOT support virtual mode (supports_virtual = false)
 *     • have no supertext
 *     • use total_value formatted as "[X/Y]".
 */
router.post("/page", async (req, res, next) => {
    try {
        const body = req.body as Partial<StatisticsPageRequestDto>;

        const statsPage = (body.stats_page ?? "total_score") as StatisticsPageRequestDto["stats_page"];

        const allowedPages: StatisticsPageRequestDto["stats_page"][] = [
            "total_score",
            "eagles",
            "total_points",
            "ups_missed",
            "longest_time",
            "most_efficient",
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

export default router;