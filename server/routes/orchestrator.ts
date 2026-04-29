import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { isAuthenticated } from "../auth";
import { PictureDraftOrchestrator } from "../modules/orchestrator/pictureDraft";

// Orchestrator HTTP surface.
//
// One endpoint per orchestrator method. The UI subscribes to /state for the
// public state, fires actions through /action, and pushes chat turns through
// /chat-turn. As more orchestrators ship (analysis/draft, etc.), this router
// stays narrow — the registry below is the only thing that grows.

const router = Router();
router.use(isAuthenticated);

// Registry: maps (phase, step) → orchestrator class. Phase A ships with
// just picture/draft; the rest are added one at a time in subsequent PRs.
//
// IMPORTANT: this registry is the only place that knows the full set of
// orchestrators. If you add a new one, register it here AND add a UI client
// for the (phase, step) it owns.
type Ctor = new (userId: string, subStepId: number) => PictureDraftOrchestrator;
const REGISTRY: Record<string, Ctor> = {
  "picture/draft": PictureDraftOrchestrator,
};

function pickOrchestrator(phase: string, step: string, userId: string, subStepId: number) {
  const ctor = REGISTRY[`${phase}/${step}`];
  if (!ctor) return null;
  return new ctor(userId, subStepId);
}

// GET /api/orchestrator/:phase/:step/:subStepId/state
//
// Returns the orchestrator's current public state for a given (phase, step,
// subStepId). The UI polls this — typically every 2-3 seconds while the
// status is `working` or `recovering`, less often otherwise.
router.get("/api/orchestrator/:phase/:step/:subStepId/state", async (req, res) => {
  const user = req.user as { id: string };
  const { phase, step, subStepId } = req.params;
  const subStepIdNum = Number.parseInt(subStepId, 10);
  if (!Number.isFinite(subStepIdNum)) {
    return res.status(400).json({ error: "invalid_sub_step_id" });
  }
  const orchestrator = pickOrchestrator(phase, step, user.id, subStepIdNum);
  if (!orchestrator) {
    return res.status(404).json({ error: "no_orchestrator", phase, step });
  }
  try {
    const state = await orchestrator.getState();
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error(`[orchestrator] getState failed for ${phase}/${step}/${subStepId}:`, err);
    res.status(500).json({ error: "state_failed", message });
  }
});

// POST /api/orchestrator/:phase/:step/:subStepId/run
//
// Invokes the orchestrator's run(). Idempotent — calling while already
// `working` is a safe no-op. Returns the post-run state.
router.post("/api/orchestrator/:phase/:step/:subStepId/run", async (req, res) => {
  const user = req.user as { id: string };
  const { phase, step, subStepId } = req.params;
  const subStepIdNum = Number.parseInt(subStepId, 10);
  if (!Number.isFinite(subStepIdNum)) {
    return res.status(400).json({ error: "invalid_sub_step_id" });
  }
  const orchestrator = pickOrchestrator(phase, step, user.id, subStepIdNum);
  if (!orchestrator) {
    return res.status(404).json({ error: "no_orchestrator", phase, step });
  }
  try {
    await orchestrator.run();
    const state = await orchestrator.getState();
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error(`[orchestrator] run failed for ${phase}/${step}/${subStepId}:`, err);
    res.status(500).json({ error: "run_failed", message });
  }
});

// GET /api/orchestrator/:phase/:step/:subStepId/report
//
// Bundle for support / admin tooling: current state + history + recent
// audit_logs entries for this orchestrator + the precondition snapshot for
// each transition target. Lighter version of "what happened with this user
// at this step" — replaces hand-rolled SQL queries the team has been doing
// when debugging stuck states.
//
// Does NOT include the artefact (analysis result) by default. Pass
// ?includeArtefact=1 to add it, but that's heavy and only worth fetching
// when actually inspecting the artefact.
router.get("/api/orchestrator/:phase/:step/:subStepId/report", async (req, res) => {
  const user = req.user as { id: string };
  const { phase, step, subStepId } = req.params;
  const subStepIdNum = Number.parseInt(subStepId, 10);
  if (!Number.isFinite(subStepIdNum)) {
    return res.status(400).json({ error: "invalid_sub_step_id" });
  }
  const orchestrator = pickOrchestrator(phase, step, user.id, subStepIdNum);
  if (!orchestrator) {
    return res.status(404).json({ error: "no_orchestrator", phase, step });
  }
  try {
    const state = await orchestrator.getState();
    const resourceId = `${phase}/${step}/${subStepId}`;
    const recentAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, user.id),
          eq(auditLogs.resourceType, "orchestrator"),
          eq(auditLogs.resourceId, resourceId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(40);

    // Precondition snapshot per known transition target. Lets support see
    // "what's blocking agreement right now" without trial-and-error.
    const preconditions = {
      kickoff: await orchestrator.canTransition({ kind: "kickoff" }),
      agree: await orchestrator.canTransition({ kind: "agree" }),
      advance: await orchestrator.canTransition({ kind: "advance" }),
      retry: await orchestrator.canTransition({ kind: "retry" }),
    };

    res.json({
      state,
      preconditions,
      auditLog: recentAudits,
      // Artefact deliberately omitted by default. Pass ?includeArtefact=1
      // when debugging the actual content.
      artefactIncluded: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error(`[orchestrator] report failed for ${phase}/${step}/${subStepId}:`, err);
    res.status(500).json({ error: "report_failed", message });
  }
});

// POST /api/orchestrator/:phase/:step/:subStepId/action
//
// Dispatches a UiAction. Body shape matches the UiAction discriminated union
// in modules/orchestrator/types.ts.
router.post("/api/orchestrator/:phase/:step/:subStepId/action", async (req, res) => {
  const user = req.user as { id: string };
  const { phase, step, subStepId } = req.params;
  const subStepIdNum = Number.parseInt(subStepId, 10);
  if (!Number.isFinite(subStepIdNum)) {
    return res.status(400).json({ error: "invalid_sub_step_id" });
  }
  const orchestrator = pickOrchestrator(phase, step, user.id, subStepIdNum);
  if (!orchestrator) {
    return res.status(404).json({ error: "no_orchestrator", phase, step });
  }
  try {
    const result = await orchestrator.onUiAction(req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error(`[orchestrator] action failed for ${phase}/${step}/${subStepId}:`, err);
    res.status(500).json({ error: "action_failed", message });
  }
});

export default router;
