// src/modules/wp/wp.service.ts
import fetch from "node-fetch";
import { llmLog } from "../llm/llm.debug";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { env } from "../../config/env";

/**
 * Delivery mode (via .env)
 *   WP_DELIVERY_MODE = "rest" | "hot"   (default: "rest")
 *
 * For REST:
 *   WP_BASE_URL, WP_USER, WP_APP_PASSWORD
 *
 * For HOT:
 *   WP_HOT_INBOX   = absolute path to inbox dir
 *   API_SECRET = shared HMAC secret
 */
const MODE = env.wp.deliveryMode;

// ------------------------- REST -------------------------
function resolveApiRoot(): string {
    const raw = (env.wp.base || "").trim().replace(/\/+$/, "");
    if (!raw) throw new Error("WP_BASE_URL is not set");
    if (raw.endsWith("/wp-json/wp/v2")) return raw;
    if (raw.includes("/wp-json/")) return raw;
    return raw + "/wp-json/wp/v2";
}

const API_ROOT = resolveApiRoot();
const WP_USER = env.wp.user;
const WP_APP_PASSWORD = env.wp.appPassword;
const AUTH = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

if (MODE === "rest" && (!WP_USER || !WP_APP_PASSWORD)) {
    llmLog("[WP][REST] Warning: WP_USER or WP_APP_PASSWORD missing. Updates will fail with 401.");
}

// ------------------------- HOT --------------------------
const HOT_INBOX = env.wp.hotInbox;
const HOT_SECRET = env.apiSecret;

function ensureDirExists(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
}
function safeFileBase(input: string | number): string {
    return String(input).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128);
}
function hmacSha256(data: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(data, "utf8").digest("hex");
}
function nowIso() {
    return new Date().toISOString();
}

function hotFolderReady(): boolean {
    if (MODE !== "hot") return false;
    if (!HOT_INBOX) {
        llmLog("[WP][HOT] ERROR: WP_HOT_INBOX not set.");
        return false;
    }
    if (!HOT_SECRET) {
        llmLog("[WP][HOT] ERROR: API_SECRET not set.");
        return false;
    }
    return true;
}

async function writeHotEnvelope(opts: {
    wpId: number;
    content: string;
    kind?: string;
    eventId?: number;
    language?: string;
}) {
    if (!hotFolderReady()) throw new Error("Hot-folder mode not correctly configured.");
    ensureDirExists(HOT_INBOX);

    const stamp = nowIso().replace(/[:.]/g, "-");
    const file = `${safeFileBase(opts.wpId)}-${stamp}.json`;
    const fullPath = path.resolve(HOT_INBOX, file);

    const payload = {
        type: "wp_update",
        kind: opts.kind || "sportevenement_content",
        wpId: opts.wpId,
        eventId: opts.eventId ?? null,
        language: opts.language ?? null,
        content: opts.content,
        meta: { producedAt: nowIso(), producer: "duizendrovers-api" },
    };

    const body = JSON.stringify(payload, null, 2); // exact bytes we sign
    const sig = hmacSha256(body, HOT_SECRET);

    const envelope = {
        signature: { alg: "HMAC-SHA256", hex: sig, hint: HOT_SECRET.slice(0, 4) + "…" },
        payload,
        signed: body,
    };

    fs.writeFileSync(fullPath, JSON.stringify(envelope, null, 2), "utf8");
    llmLog("[WP][HOT] wrote", fullPath);
    return fullPath;
}

// --------------------- PUBLIC API -----------------------
/** Kept for backwards compatibility (no context). */
export async function updateWpPostContent(wpId: number, content: string) {
    return updateWpPostContentWithContext({ wpId, content });
}

/** Single entry point used by routes. Internally switches by env. */
export async function updateWpPostContentWithContext(opts: {
    wpId: number;
    content: string; // Markdown or HTML—your call
    eventId?: number;
    language?: "nl" | "en" | string;
}) {
    if (MODE === "hot") {
        const p = await writeHotEnvelope({
            wpId: opts.wpId,
            content: opts.content,
            kind: "sportevenement_content",
            eventId: opts.eventId,
            language: opts.language,
        });
        llmLog("[WP] delivery=hot ok →", p);
        return;
    }

    const url = `${API_ROOT}/sportevenement/${opts.wpId}`;
    llmLog("[WP] PUT", url, "(len:", opts.content.length, ")", "delivery=rest");

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: AUTH,
            // harmless extra header; keep if you like:
            "X-GB-App-Auth": AUTH,
        },
        body: JSON.stringify({ content: opts.content }),
    });

    const text = await res.text();
    llmLog("[WP] response", res.status, text.slice(0, 400));
    if (!res.ok) throw new Error(`WP update failed ${res.status}: ${text}`);
}

// --------------------- PUBLIC API: comments -----------------------
export async function postWpComment(opts: {
    postId: number;
    authorName: string;
    authorEmail: string;
    content: string;
}) {
    const url = `${API_ROOT}/comments`;
    const payload = {
        post: opts.postId,
        author_name: opts.authorName,
        author_email: opts.authorEmail,
        content: opts.content,
    };

    llmLog("[WP][COMMENTS] POST", url, "payload:", JSON.stringify(payload));

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: AUTH,
        },
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    llmLog("[WP][COMMENTS] response", res.status, text.slice(0, 400));

    if (!res.ok) {
        throw new Error(`WP comment failed ${res.status}: ${text}`);
    }
}