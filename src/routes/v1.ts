// src/routes/v1.ts
import { Router } from "express";

import seasonsRoutes from "./seasons";
import calendarRoutes from "./calendar";
import devicesRoutes from "./devices";
import pushRoutes    from "./push";
import llmRoutes     from "./llm";

import answersRoutes           from "./answers";
import solutionsRoutes         from "./solutions";
import preclassificationRoutes from "./preclassification";

const v1 = Router();

v1.get("/health", (_req, res) => res.json({ ok: true }));

v1.use("/seasons", seasonsRoutes);
v1.use("/calendar", calendarRoutes);
v1.use("/devices", devicesRoutes);
v1.use("/push",    pushRoutes);
v1.use("/llm",     llmRoutes);

// Game routes
v1.use("/answers",           answersRoutes);            // POST /v1/answers
v1.use("/solutions",         solutionsRoutes);          // POST /v1/solutions, POST /v1/solutions/:betId/apply
v1.use("/preclassification", preclassificationRoutes);  // POST /v1/preclassification/:betId/rebuild

export default v1;