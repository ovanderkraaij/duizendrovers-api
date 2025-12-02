//src/routes/devices.ts
import { Router } from "express";
import { upsertDeviceToken } from "../modules/push/push.repo";

const router = Router();

/** POST /api/v1/devices/register */
router.post("/register", async (req, res, next) => {
    try {
        const { token, platform, locale, tz } = req.body || {};
        if (!token || !platform) return res.status(400).json({ error: "token and platform required" });

        const userId = Number(req.query.userId ?? 35); // ⬅️ TEMP fallback user
        await upsertDeviceToken(userId, token, platform, locale, tz);
        res.json({ ok: true });
    } catch (e) { next(e); }
});

export default router;