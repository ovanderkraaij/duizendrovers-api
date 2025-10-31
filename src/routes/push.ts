//src/routes/push.ts
import { Router } from "express";
import { getLatestTokenForUser } from "../modules/push/push.repo";
import { sendPush, sendPushOrTopic, sendPushToTopic } from "../modules/push/push.service";

const router = Router();

/** POST /api/v1/push  (from WordPress) */
router.post("/", async (req, res, next) => {
    try {
        const { token, topic, title, body, data } = req.body ?? {};
        // quick visibility in your node logs:
        console.log("📮 /push payload", { token: !!token, topic, title });

        if (!title || !body) return res.status(400).json({ error: "title and body are required" });
        if (!token && !topic) return res.status(400).json({ error: "token or topic is required" });

        await sendPushOrTopic({ token, topic, title, body, data });
        res.json({ ok: true });
    } catch (e) { next(e); }
});

/** POST /api/v1/push/test (manual token test) */
router.post("/test", async (req, res, next) => {
    try {
        const userId = Number(req.query.userId ?? 1);
        const token = await getLatestTokenForUser(userId);
        if (!token) return res.status(404).json({ error: "No token on file" });

        await sendPush({
            token,
            title: "Test push",
            body: "Hello from Duizendrovers (test)",
            data: { deeplink: "/events" },
        });

        res.json({ ok: true });
    } catch (e) { next(e); }
});

/** NEW: POST /api/v1/push/test-topic?topic=news  */
router.post("/test-topic", async (req, res, next) => {
    try {
        const topic = String(req.query.topic ?? "news");
        await sendPushToTopic({
            topic,
            title: "Topic test",
            body: `Hello subscribers of ${topic}`,
            data: { deeplink: "/home" },
        });
        res.json({ ok: true });
    } catch (e) { next(e); }
});

export default router;