import type { Express } from "express";
import authRouter from "./auth";
import adminRouter from "./admin";
import statementsRouter from "./statements";
import promptsRouter from "./prompts";
import analysisRouter from "./analysis";
import qaRouter from "./qa";

export function registerRoutes(app: Express) {
  app.use(authRouter);
  // Admin routers are mounted under /api/admin so their blanket isAdmin
  // middleware only applies to admin paths — NEVER mount these without a prefix.
  app.use("/api/admin", adminRouter);
  app.use("/api/admin", promptsRouter);
  app.use(statementsRouter);
  app.use(analysisRouter);
  app.use(qaRouter);
}
