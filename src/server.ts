//src/server.ts
import { createApp } from "./index";
import { env } from "./config/env";
import { pool } from "./db";

const app = createApp();

const server = app.listen(env.port, async () => {
  await pool.query("SELECT 1");
  console.log(`API listening on http://localhost:${env.port}`);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  try { await pool.end(); } catch {}
  server.close(() => process.exit(0));
});