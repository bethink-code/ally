import { Router } from "express";
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
