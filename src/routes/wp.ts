// src/routes/wp.ts
import { Router, type Request, type Response } from "express";
import { postWpComment } from "../modules/wp/wp.service";
import * as usersService from "../modules/users/users.service";

const router = Router();

/**
 * POST /api/v1/wp/comments
 * Body: { post_id: number, user_id: number, content: string }
 *
 * - Looks up the Duizend Rovers user in MySQL.
 * - Uses that user's name + email as the WordPress comment author.
 * - Authenticates to WP as Roversnest (via WP_APP_PASSWORD).
 */
router.post("/comments", async (req: Request, res: Response) => {
    try {
        const { post_id, user_id, content } = req.body ?? {};

        const postId = Number(post_id);
        const userId = Number(user_id);
        const rawText = typeof content === "string" ? content.trim() : "";

        if (!Number.isFinite(postId) || postId <= 0) {
            return res.status(400).json({ error: "Invalid post_id" });
        }
        if (!Number.isFinite(userId) || userId <= 0) {
            return res.status(400).json({ error: "Invalid user_id" });
        }
        if (!rawText) {
            return res.status(400).json({ error: "Content is required" });
        }

        const user = await usersService.getById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const nameParts = [
            user.firstname,
            user.infix,
            user.lastname,
        ].filter(Boolean) as string[];
        const authorName = nameParts.join(" ").trim() || `Rover ${userId}`;
        const authorEmail = user.email ?? "";

        if (!authorEmail) {
            return res.status(400).json({ error: "User has no email address" });
        }

        await postWpComment({
            postId,
            authorName,
            authorEmail,
            content: rawText,
        });

        return res.status(201).json({ ok: true });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[WP][comments] internal error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

export default router;