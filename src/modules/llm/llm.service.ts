// src/modules/llm/llm.service.ts
import OpenAI from "openai";
import { sportEventSystemPrompt, sportEventUserPrompt, SportEventContext } from "./prompts";
import { llmLog } from "./llm.debug";
import { env } from "../../config/env";

const client = new OpenAI({ apiKey: env.llm.apiKey });

// Force gpt-5 by default; you can still override via .env if you want
const MODEL = env.llm.model;
const MAX_TOKENS = env.llm.maxTokens;

// Remove empty/placeholder "More info" blocks and empty anchors
function sanitizeMoreInfo(html: string, officialUrl?: string): string {
    let out = html || "";

    // Strip the “More info/Meer info” section if we don't have a URL
    if (!officialUrl) {
        out = out.replace(/\s*<h3>\s*(More info|Meer info)\s*<\/h3>\s*<p>[\s\S]*?<\/p>/i, "").trim();
    }

    // Remove anchors with empty href
    out = out.replace(/<a\b[^>]*href=["']\s*["'][^>]*>[\s\S]*?<\/a>/gi, "");

    // Remove empty paragraphs created by the removal above
    out = out.replace(/<p>\s*<\/p>/g, "");

    return out;
}

// Pull plain text from Responses API output
function extractOutputText(resp: OpenAI.Responses.Response): string {
    // Newer SDKs expose a convenience getter at runtime
    // @ts-ignore
    const ot = (resp as any).output_text;
    if (typeof ot === "string" && ot.trim()) return ot.trim();

    if (Array.isArray(resp.output)) {
        for (const item of resp.output) {
            if (item?.type === "message" && Array.isArray(item.content)) {
                for (const c of item.content) {
                    if (c?.type === "output_text" && typeof c.text === "string" && c.text.trim()) {
                        return c.text.trim();
                    }
                    if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) {
                        return c.text.trim();
                    }
                }
            }
        }
    }
    return "";
}

export async function generateSportEventMarkdown(ctx: SportEventContext): Promise<string> {
    const sys = sportEventSystemPrompt(ctx.language ?? "nl");
    const user = sportEventUserPrompt(ctx);

    llmLog("[LLM] model", MODEL);
    llmLog("[LLM] tokens.max", MAX_TOKENS);

    // gpt-5 via Responses API:
    // - Do NOT send temperature (gpt-5 uses default only)
    // - Do NOT send modalities (causes 400)
    // - Use content type "input_text" for inputs
    const resp = await client.responses.create({
        model: MODEL,
        max_output_tokens: MAX_TOKENS,
        input: [
            {
                role: "system",
                content: [{ type: "input_text", text: sys }],
            },
            {
                role: "user",
                content: [{ type: "input_text", text: user }],
            },
        ],
    });

    // Debug metadata to help diagnose empty outputs
    llmLog(
        "[LLM][responses] meta",
        JSON.stringify(
            {
                id: resp.id,
                status: resp.status,
                usage: resp.usage,
                firstType: resp.output?.[0]?.type,
            },
            null,
            2
        )
    );

    const raw = extractOutputText(resp);
    llmLog("[LLM] raw.length", raw.length);

    if (!raw) {
        throw new Error("LLM returned empty content; aborting write.");
    }

    const html = sanitizeMoreInfo(raw, ctx.officialUrl);
    return html;
}