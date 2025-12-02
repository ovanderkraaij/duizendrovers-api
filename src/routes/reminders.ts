// src/routes/reminders.ts
import type { Request, Response } from "express";
import { Router } from "express";
import { runReminders, type ReminderMode } from "../modules/reminders/reminders.service";
import { env } from "../config/env";

const router = Router();

/**
 * POST /api/v1/reminders/run
 *
 * Headers:
 *   X-Reminder-Secret: <secret from env API_SECRET>
 *
 * Body (JSON):
 *   {
 *     "mode": "opening" | "reminder"
 *   }
 */
router.post("/run", async (req: Request, res: Response) => {
    try {
        const headerSecret = req.header("X-Reminder-Secret");
        const expected = env.apiSecret;

        if (!expected || headerSecret !== expected) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const modeRaw = (req.body?.mode ?? "").toString().trim();
        if (modeRaw !== "opening" && modeRaw !== "reminder") {
            return res.status(400).json({
                error: 'Invalid mode; expected "opening" or "reminder".',
            });
        }

        const mode = modeRaw as ReminderMode;

        const summary = await runReminders(mode);
        return res.json(summary);
    } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error("[reminders] run error", err);
        return res.status(500).json({
            error: "Internal error while running reminders",
        });
    }
});

export default router;