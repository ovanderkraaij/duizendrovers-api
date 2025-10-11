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
    connLimit: Number(req("DB_CONN_LIMIT", "10"))
  },

  wp: {
    base: req("WP_BASE")
  },

  corsOrigin: (process.env.CORS_ORIGIN ?? "").split(",").filter(Boolean)
};
