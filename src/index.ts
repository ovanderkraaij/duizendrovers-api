// src/index.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import v1 from "./routes/v1";
import { requestLogger } from "./middleware/requestLogger";
import { notFound } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cors({ origin: env.corsOrigin.length ? env.corsOrigin : true }));
  app.use(requestLogger);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/v1", v1);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}