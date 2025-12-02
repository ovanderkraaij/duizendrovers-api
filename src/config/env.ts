// src/config/env.ts
import * as dotenv from "dotenv";
dotenv.config();

function req(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),

  db: {
    host: req("DB_HOST"),
    port: Number(req("DB_PORT", "3306")),
    user: req("DB_USER"),
    password: req("DB_PASSWORD"),
    name: req("DB_NAME"),
    connLimit: Number(req("DB_CONN_LIMIT", "10")),
  },

  /** WordPress / content */
  wp: {
    base: req("WP_BASE_URL"),
    user: process.env.WP_USER || "",
    appPassword: (process.env.WP_APP_PASSWORD || "").replace(/\s+/g, ""),
    deliveryMode: (process.env.WP_DELIVERY_MODE || "rest").toLowerCase() as "rest" | "hot",
    hotInbox: (process.env.WP_HOT_INBOX || "").trim(),
  },

  /** Shared API secret (used for WP hot-folder + reminders route) */
  apiSecret: process.env.API_SECRET || "",

  /** Comma-separated CORS origins */
  corsOrigin: (process.env.CORS_ORIGIN ?? "").split(",").filter(Boolean),

  /** LLM / OpenAI */
  llm: {
    apiKey: req("OPENAI_API_KEY"),
    model: process.env.LLM_MODEL || "gpt-5",
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 4000),
    debug: process.env.LLM_DEBUG === "1",
  },

  /** Mail / sendmail wrapper */
  mail: {
    enabled: process.env.MAIL_ENABLED === "1",
    from: process.env.MAIL_FROM || "De De Duizend Rovers <duizendrovers@gmail.com>",
    binary: process.env.MAIL_BINARY || "mail",
  },

  /** Reminders specific flags */
  reminders: {
    // local/test = 0, production = 1
    sendMail: process.env.SENT_MAIL_NOTIFICATIONS === "1",
  },

  /** Firebase / FCM + push sounds */
  firebase: {
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
  },

  push: {
    iosSound: process.env.IOS_SOUND || undefined,
    androidSound: process.env.ANDROID_SOUND || undefined,
    androidChannelId: process.env.ANDROID_SOUND_CHANNEL || undefined,
  },

  /** Feature flags / misc */
  debug: {
    calendar: process.env.DEBUG_CALENDAR === "1",
  },

  answers: {
    autoApplySolutions: process.env.AUTO_APPLY_SOLUTIONS === "1",
  },
};