// src/modules/push/push.service.ts
import admin from "firebase-admin";
import path from "path";
import { env } from "../../config/env";

const creds = env.firebase.credentialsPath;

if (!admin.apps.length) {
    if (!creds) throw new Error("GOOGLE_APPLICATION_CREDENTIALS not set");
    admin.initializeApp({
        credential: admin.credential.cert(path.resolve(creds)),
    });
}

/**
 * Send a **data-only** push notification.
 *
 * Reasoning:
 * - We avoid the FCM `notification` block so the OS does NOT auto-display a system notification.
 * - The Flutter app is then fully in control of showing exactly one notification
 *   (typically in `FirebaseMessaging.onMessage` / `onBackgroundMessage` via flutter_local_notifications).
 * - This prevents the classic "double notification" problem:
 *     1) OS shows notification from `notification` block
 *     2) App shows another via local notification
 *
 * The title/body are still sent, but inside the `data` payload.
 */
export async function sendPush(opts: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
}) {
    const data: Record<string, string> = {
        title: opts.title,
        body: opts.body,
        ...(opts.data ?? {}),
    };

    return admin.messaging().send({
        token: opts.token,
        data,
        apns: {
            payload: {
                aps: {
                    sound: env.push.iosSound,
                    badge: 1,
                },
            },
        },
        android: {
            notification: {
                // For data-only messages, this still configures the channel/sound,
                // but the actual display is controlled by the client.
                sound: env.push.androidSound,
                channelId: env.push.androidChannelId,
            },
        },
    });
}

// NEW: topic helper (data-only as well)
export async function sendPushToTopic(opts: {
    topic: string; // e.g. "news" (NO "/topics/" prefix here)
    title: string;
    body: string;
    data?: Record<string, string>;
}) {
    const t = opts.topic.replace(/^\/?topics\//, "");

    const data: Record<string, string> = {
        title: opts.title,
        body: opts.body,
        ...(opts.data ?? {}),
    };

    return admin.messaging().send({
        topic: t,
        data,
        apns: {
            payload: {
                aps: {
                    sound: env.push.iosSound,
                    badge: 1,
                },
            },
        },
        android: {
            notification: {
                sound: env.push.androidSound,
                channelId: env.push.androidChannelId,
            },
        },
    });
}

// Optional: a union that chooses token vs topic in one call
export async function sendPushOrTopic(opts: {
    token?: string;
    topic?: string;
    title: string;
    body: string;
    data?: Record<string, string>;
}) {
    if (opts.token) {
        return sendPush({
            token: opts.token,
            title: opts.title,
            body: opts.body,
            data: opts.data,
        });
    }

    if (opts.topic) {
        return sendPushToTopic({
            topic: opts.topic,
            title: opts.title,
            body: opts.body,
            data: opts.data,
        });
    }

    throw new Error("sendPushOrTopic requires either token or topic");
}