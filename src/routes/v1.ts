// src/routes/v1.ts
import { Router } from "express";

import seasonsRoutes from "./seasons";
import calendarRoutes from "./calendar";
import devicesRoutes from "./devices";
import pushRoutes    from "./push";
import llmRoutes     from "./llm";
import betsRoutes    from "./bets";
import answersRoutes from "./answers";
import solutionsRoutes         from "./solutions";
import preclassificationRoutes from "./preclassification";
import squadsRoutes            from "./squads";
import predictionsRoutes from "./predictions";

const v1 = Router();

v1.get("/health", (_req, res) => res.json({ ok: true }));

v1.use("/seasons", seasonsRoutes);
v1.use("/calendar", calendarRoutes);
v1.use("/devices", devicesRoutes);
v1.use("/push",    pushRoutes);
v1.use("/llm",     llmRoutes);
v1.use("/bets",    betsRoutes);
v1.use("/answers", answersRoutes);
v1.use("/solutions",         solutionsRoutes);
v1.use("/preclassification", preclassificationRoutes);
v1.use("/squads",            squadsRoutes);
v1.use("/predictions", predictionsRoutes);

export default v1;