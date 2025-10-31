//src/routes/llm.ts
import { Router } from "express";
import {
  getEventBasics,
  getBetQuestionsForEvent,
  getParticipantsForListQuestions,
} from "../modules/llm/data.service";
import { generateSportEventMarkdown } from "../modules/llm/llm.service";
import { updateWpPostContentWithContext } from "../modules/wp/wp.service";
import { llmLog } from "../modules/llm/llm.debug";

const router = Router();

/**
 * POST /api/v1/llm/generate-content
 * body: {
 *   eventId: number,
 *   wpId: number,
 *   lang?: 'nl'|'en',
 *   officialUrl?: string,
 *   eventType?: 'league'|'one_day'
 * }
 */
router.post("/generate-content", async (req, res, next) => {
  try {
    const eventId = Number(req.body?.eventId);
    const wpId = Number(req.body?.wpId);
    const lang = (req.body?.lang === "en" ? "en" : "nl") as "nl" | "en";
    const officialUrl =
        typeof req.body?.officialUrl === "string"
            ? req.body.officialUrl.trim()
            : undefined;
    const eventType =
        req.body?.eventType === "league" || req.body?.eventType === "one_day"
            ? (req.body.eventType as "league" | "one_day")
            : undefined;

    if (!eventId) return res.status(400).json({ error: "eventId required" });
    if (!wpId) return res.status(400).json({ error: "wpId required" });

    llmLog("incoming", { eventId, lang, wpId, officialUrl, eventType });

    const event = await getEventBasics(eventId);
    if (!event) {
      llmLog("eventNotFound", { eventId });
      return res.status(404).json({ error: "event not found" });
    }

    const [questions, participants] = await Promise.all([
      getBetQuestionsForEvent(eventId),
      getParticipantsForListQuestions(eventId),
    ]);

    const html = await generateSportEventMarkdown({
      language: lang,
      event: {
        id: event.id,
        title: event.title,
        sport: event.sport,
        type: eventType, // optional hint (league vs one-day)
      },
      questions,
      deadlineIso: event.deadlineIso, // ISO 8601 or undefined
      participants,
      officialUrl,
    });

    llmLog("generated.length", html.length);
    llmLog("generated.preview", html.slice(0, 200));

    await updateWpPostContentWithContext({
      wpId,
      content: html, // already HTML per prompt
      eventId,
      language: lang,
    });

    return res.json({ ok: true, eventId, wpId, length: html.length });
  } catch (err) {
    llmLog(
        "error",
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    );
    next(err);
  }
});

export default router;