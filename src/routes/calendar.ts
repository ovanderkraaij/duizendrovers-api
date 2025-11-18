// src/routes/calendar.ts
import { Router } from "express";
import { getCalendar } from "../modules/calendar/calendar.service";

const router = Router();

/**
 * GET /api/v1/calendar
 * Returns merged, sorted list of calendar teaser items for the open season.
 * Add ?debug=1 to log a small sample.
 */
router.get("/", async (req, res) => {
    try {
        const items = await getCalendar();

        const debug = req.query.debug === "1" || process.env.DEBUG_CALENDAR === "1";
        if (debug) {
            const sample = items.slice(0, 3).map((x) => ({
                id: x.id,
                title: x.title,
                deadlineUtc: x.deadlineUtc,
                expectedUtc: x.expectedUtc,
                effectiveDeadlineUtc: x.effectiveDeadlineUtc,
                hasSolution: x.hasSolution,
                virtualAnyMain: x.virtualAnyMain, // ← NEW
            }));
            console.log("[CALENDAR DEBUG] sample payload:", JSON.stringify(sample, null, 2));
        }

        res.json(items);
    } catch (err: any) {
        console.error("Error in GET /calendar:", err);
        res.status(500).json({ error: "Failed to load calendar" });
    }
});

export default router;