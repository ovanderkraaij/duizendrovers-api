import { Router } from "express";
import seasonsRoutes from "./seasons";
import calendarRoutes from "./calendar";
import devicesRoutes from "./devices";
import pushRoutes from "./push";
import llmRoutes from "./llm";

const v1 = Router();

v1.get("/health", (_req, res) => res.json({ ok: true }));

v1.use("/seasons", seasonsRoutes);
v1.use("/calendar", calendarRoutes);
v1.use("/devices", devicesRoutes);
v1.use("/push",    pushRoutes);
v1.use("/llm",     llmRoutes);

export default v1;