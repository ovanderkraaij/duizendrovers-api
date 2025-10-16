// src/routes/v1.ts
import { Router } from "express";
import seasonsRoutes from "./seasons";
import calendarRoutes from "./calendar";
import devicesRoutes from "./devices";
import pushRoutes from "./push";

const v1 = Router();

v1.get("/health", (_req, res) => res.json({ ok: true }));

// canonical new API
v1.use("/seasons", seasonsRoutes);
v1.use("/calendar", calendarRoutes);
v1.use("/devices", devicesRoutes);
v1.use("/push", pushRoutes);

export default v1;