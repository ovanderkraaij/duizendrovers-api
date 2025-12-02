// src/modules/mail/mail.service.ts
import { spawn } from "child_process";
import { env } from "../../config/env";

/**
 * Simple sendmail-based mail service.
 *
 * - Uses the system `mail` binary (as in your example).
 * - Controlled by env:
 *   - MAIL_ENABLED = "1" → actually send mail
 *   - otherwise → no-op (logs to console), so local/dev won't break.
 *
 * Example env for test/prod:
 *   MAIL_ENABLED=1
 *   MAIL_FROM="De Duizend Rovers <duizendrovers@gmail.com>"
 *   MAIL_BINARY=/usr/bin/mail
 */

const MAIL_ENABLED = env.mail.enabled;
const MAIL_FROM = env.mail.from;
const MAIL_BINARY = env.mail.binary;

export interface SendMailOptions {
    to: string;
    subject: string;
    body: string;
}

/**
 * Send a plain-text mail using the system mail binary.
 *
 * Note:
 * - No attachments for reminders (not needed).
 * - We add a From: header via -a, mirroring your example.
 */
export async function sendMail(opts: SendMailOptions): Promise<void> {
    if (!MAIL_ENABLED) {
        // Safe no-op for local/dev
        // eslint-disable-next-line no-console
        console.log("[mail] MAIL_ENABLED != 1 → skipping mail send", {
            to: opts.to,
            subject: opts.subject,
        });
        return;
    }

    return new Promise<void>((resolve, reject) => {
        const args = ["-s", opts.subject, "-a", `From: ${MAIL_FROM}`, opts.to];

        const child = spawn(MAIL_BINARY, args);

        child.stdin.write(opts.body);
        child.stdin.end();

        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `mail exited with code ${code ?? "null"}; stderr: ${stderr || "<empty>"}`
                    )
                );
            }
        });

        child.on("error", (err) => {
            reject(err);
        });
    });
}