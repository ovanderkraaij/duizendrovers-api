// src/modules/push/push.service.ts
import admin from "firebase-admin";
import path from "path";

const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!admin.apps.length) {
    if (!creds) throw new Error("GOOGLE_APPLICATION_CREDENTIALS not set");
    admin.initializeApp({ credential: admin.credential.cert(path.resolve(creds)) });
}

export async function sendPush(opts: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
}) {
    return admin.messaging().send({
        token: opts.token,
        notification: { title: opts.title, body: opts.body },
        data: opts.data ?? {},
        apns: { payload: { aps: { sound: process.env.IOS_SOUND, badge: 1 } } },
        android: {
            notification: {
                sound: process.env.ANDROID_SOUND,
                channelId: process.env.ANDROID_SOUND_CHANNEL,
            },
        },
    });
}

// NEW: topic helper
export async function sendPushToTopic(opts: {
    topic: string;                 // e.g. "news" (NO "/topics/" prefix here)
    title: string;
    body: string;
    data?: Record<string, string>;
}) {
    // normalize if someone sent "/topics/news"
    const t = opts.topic.replace(/^\/?topics\//, "");
    return admin.messaging().send({
        topic: t,
        notification: { title: opts.title, body: opts.body },
        data: opts.data ?? {},
        apns: { payload: { aps: { sound: process.env.IOS_SOUND, badge: 1 } } },
        android: {
            notification: {
                sound: process.env.ANDROID_SOUND,
                channelId: process.env.ANDROID_SOUND_CHANNEL,
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
    if (opts.token) return sendPush({ token: opts.token, title: opts.title, body: opts.body, data: opts.data });
    if (opts.topic) return sendPushToTopic({ topic: opts.topic, title: opts.title, body: opts.body, data: opts.data });
    throw new Error("sendPushOrTopic requires either token or topic");
}