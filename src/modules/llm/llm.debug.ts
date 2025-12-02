// src/modules/llm/llm.debug.ts
import fs from "fs";
import path from "path";
import { env } from "../../config/env";

const LLM_DEBUG = env.llm.debug;

export function llmDebugEnabled() {
    return LLM_DEBUG;
}

export function llmLog(...args: any[]) {
    if (!LLM_DEBUG) return;
    // eslint-disable-next-line no-console
    console.log("[LLM]", ...args);
}

export function writeDebugFile(eventId: number, basename: string, content: string) {
    if (!LLM_DEBUG) return;
    const dir = path.resolve(process.cwd(), "logs/llm");
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `event-${eventId}-${basename}-${ts}.txt`);
    fs.writeFileSync(file, content, "utf8");
    return file;
}