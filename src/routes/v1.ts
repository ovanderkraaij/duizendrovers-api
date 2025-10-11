import { Router } from "express";
import seasonsRoutes from "./seasons";
import calendarRoutes from "./calendar";

const v1 = Router();

v1.get("/health", (_req, res) => res.json({ ok: true }));

// canonical new API
v1.use("/seasons", seasonsRoutes);
v1.use("/calendar", calendarRoutes);

export default v1;