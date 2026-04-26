// ============================================================================
// Navigation — single source of truth for "what is each canvas/beat's relation
// to the user's actual state, and is it navigable?"
//
// Replaces the ad-hoc copies of this logic that previously lived in
// CanvasMenu's PillTrigger, CanvasTabs, PictureStages, AnalysisStages,
// PlanStages, ProgressStages, and Dashboard.onNavigateSubStep.
//
// One module, one model. Every UI surface reads from here.
// ============================================================================

import { BEAT_ORDER, beatRelation, type Beat, type BeatRelation } from "./beats";
import { BEAT_LABEL, CANVAS_KEYS, type CanvasKey } from "./canvasCopy";
import { formatDate } from "./formatters";
import type {
  Statement,
  Analysis,
  AnalysisDraft,
  Conversation,
  SubStep,
} from "@shared/schema";

// --- Types ----------------------------------------------------------------

export type CanvasRelation = "current" | "past" | "next" | "later" | "dormant";

// All the state the navigation rules need to make decisions. Centralised so
// every caller passes the same shape — no missed inputs.
export type NavContext = {
  /** User's forward-facing sub-step — exactly one canvas. */
  subStep: SubStep | null;
  /** Latest non-superseded analysis draft (Canvas 2). null = not started. */
  draft: AnalysisDraft | null;
  /** Legacy Canvas 1 conversation (status flips on reopen). */
  conversation: Conversation | null;
  /** Latest done first-take analysis (Canvas 1). */
  analysis: Analysis | null;
  /** Statements uploaded so far. */
  statements: Statement[];
};

// --- Per-canvas current beat ---------------------------------------------

/**
 * The beat each canvas is *actually* on right now, regardless of which
 * canvas the user is currently viewing.
 *
 * For the user's forward-facing canvas, this is just `subStep.beat`. For
 * other canvases we derive from auxiliary state (draft status, conversation
 * status, statement count) — the most durable signals so peeking at a
 * non-current canvas lands you on its real position, not a stale fallback.
 */
export function getCanvasCurrentBeat(canvas: CanvasKey, ctx: NavContext): Beat {
  if (ctx.subStep && ctx.subStep.canvasKey === canvas) {
    return ctx.subStep.beat as Beat;
  }

  if (canvas === "picture") {
    // If user has moved past picture (sub-step on analysis), picture is at
    // live. Otherwise derive from legacy state.
    if (ctx.subStep && ctx.subStep.canvasKey !== "picture") return "live";
    if (ctx.conversation?.status === "complete") return "live";
    if (ctx.analysis?.status === "done") return "discuss";
    if (ctx.statements.some((s) => s.status === "extracted")) return "gather";
    return "gather";
  }

  if (canvas === "analysis") {
    // Derive from draft status — the durable signal that survives reopen.
    if (!ctx.draft) return "analyse";
    if (ctx.draft.status === "agreed") return "live";
    if (ctx.draft.status === "ready") return "discuss";
    return "analyse"; // thinking / failed / superseded
  }

  // Plan + Progress: not yet built. Return gather as a safe default.
  return "gather";
}

// --- Per-canvas relation -------------------------------------------------

/**
 * How does this canvas relate to where the user is right now?
 *
 *   current — the canvas the user is naturally on (subStep lives here)
 *   past    — has been agreed at least once (durable signal: draft exists
 *             for picture, future-canvas progress for analysis)
 *   next    — the canvas they unlock when they agree their current one
 *   later   — further out than next
 *   dormant — needs a precondition (progress waits for plan in motion)
 */
export function getCanvasRelation(canvas: CanvasKey, ctx: NavContext): CanvasRelation {
  const naturalCanvas = naturalCanvasFor(ctx);
  if (canvas === naturalCanvas) return "current";

  // Past: durable "this canvas has been agreed at least once" signal.
  // Picture is past if Canvas 2 has been started (draft creation only fires
  // on Canvas 1 agree) OR if conversation is currently complete.
  if (canvas === "picture") {
    if (ctx.draft != null) return "past";
    if (ctx.conversation?.status === "complete") return "past";
  }
  // Analysis is past if user has moved beyond it (sub-step on plan/progress).
  if (canvas === "analysis") {
    if (ctx.subStep && (ctx.subStep.canvasKey === "plan" || ctx.subStep.canvasKey === "progress")) {
      return "past";
    }
  }

  // Otherwise position relative to natural canvas.
  const naturalIdx = CANVAS_KEYS.indexOf(naturalCanvas);
  const thisIdx = CANVAS_KEYS.indexOf(canvas);
  if (thisIdx === naturalIdx + 1) return "next";
  if (canvas === "progress") return "dormant";
  return "later";
}

function naturalCanvasFor(ctx: NavContext): CanvasKey {
  if (ctx.subStep) return ctx.subStep.canvasKey as CanvasKey;
  if (ctx.draft) return "analysis";
  if (ctx.conversation?.status === "complete") return "analysis";
  return "picture";
}

// --- Per-beat relation ---------------------------------------------------

/**
 * A beat's relation within its own canvas. Past = before the canvas's
 * current beat. Current = the canvas's current beat. Future = after.
 */
export function getBeatRelation(canvas: CanvasKey, beat: Beat, ctx: NavContext): BeatRelation {
  return beatRelation(getCanvasCurrentBeat(canvas, ctx), beat);
}

// --- Clickability --------------------------------------------------------

/**
 * Is this canvas clickable for navigation? Permissive — every canvas is
 * clickable, even "later" / "dormant" ones. Clicking a not-yet-built canvas
 * lands on its placeholder landing card; clicking a real one navigates.
 *
 * The peek-only "tab in megamenu" behaviour is layered on top by the caller.
 */
export function isCanvasNavigable(_canvas: CanvasKey, _ctx: NavContext): boolean {
  return true;
}

/**
 * Is this beat clickable? Same answer for every beat: yes. Even future beats
 * — clicking opens a "this is what's coming" landing. Past beats open a
 * historical/peek view of that beat. Current opens the live experience.
 *
 * The previous past-or-current restriction was over-strict and stopped the
 * user navigating freely. Held here as one rule, not five.
 */
export function isBeatNavigable(_canvas: CanvasKey, _beat: Beat, _ctx: NavContext): boolean {
  return true;
}

// --- "Am I being shown but my sub-step isn't here?" ----------------------

/**
 * A beat component is in **peek mode** when it is being rendered but the
 * user's actual sub-step is somewhere else (different canvas, different
 * beat, or both). Peek mode = render historical / read-only. Live mode =
 * render the interactive experience.
 *
 * Single rule, used by every beat component to decide its render mode.
 */
export function isPeekMode(canvas: CanvasKey, beat: Beat, ctx: NavContext): boolean {
  if (!ctx.subStep) return false;
  return ctx.subStep.canvasKey !== canvas || (ctx.subStep.beat as Beat) !== beat;
}

// --- Beats list (with relation pre-computed) -----------------------------

/**
 * Convenience: returns BEAT_ORDER zipped with each beat's relation for a
 * given canvas. Lets pill timelines + stage card grids loop once.
 */
export function listBeatsWithRelation(
  canvas: CanvasKey,
  ctx: NavContext,
): Array<{ beat: Beat; relation: BeatRelation }> {
  const current = getCanvasCurrentBeat(canvas, ctx);
  return BEAT_ORDER.map((beat) => ({ beat, relation: beatRelation(current, beat) }));
}

/**
 * Convenience: returns CANVAS_KEYS zipped with each canvas's relation.
 */
export function listCanvasesWithRelation(
  ctx: NavContext,
): Array<{ canvas: CanvasKey; relation: CanvasRelation }> {
  return CANVAS_KEYS.map((canvas) => ({ canvas, relation: getCanvasRelation(canvas, ctx) }));
}

// --- Per-beat title / status copy (shared by all surfaces) ---------------

/**
 * Display title for a beat. Falls through BEAT_LABEL with a sensible
 * fallback for canvases where Gather is invisible (analysis/plan).
 */
export function getBeatTitle(canvas: CanvasKey, beat: Beat): string {
  return BEAT_LABEL[canvas][beat].title || (beat === "gather" ? "Pulled in" : beat);
}

export function getBeatDescription(canvas: CanvasKey, beat: Beat): string {
  return BEAT_LABEL[canvas][beat].description || "—";
}

/**
 * Short status caption per (canvas, beat, relation). Replaces the
 * pictureBeatStatus / analysisBeatStatus helpers that were duplicated in
 * CanvasMenu. Reads dynamic state from ctx — extraction count, analysis
 * status, draft status, agreed timestamps — so every surface (pill steps,
 * stage cards, BeatLanding fact rows) shows the same string.
 */
export function getBeatStatus(canvas: CanvasKey, beat: Beat, ctx: NavContext): string {
  const relation = getBeatRelation(canvas, beat, ctx);
  if (canvas === "picture") return pictureStatus(beat, relation, ctx);
  if (canvas === "analysis") return analysisStatus(beat, relation, ctx);
  if (canvas === "plan") return planStatus(beat);
  return progressStatus(beat);
}

function pictureStatus(beat: Beat, relation: BeatRelation, ctx: NavContext): string {
  const extractedCount = ctx.statements.filter((s) => s.status === "extracted").length;
  const analysisDone = ctx.analysis?.status === "done";
  if (beat === "gather") {
    if (relation === "current") {
      const toGo = Math.max(0, 12 - extractedCount);
      return toGo > 0 ? `${extractedCount} read · ${toGo} to go` : `${extractedCount} read`;
    }
    return relation === "past" ? `${extractedCount} · done` : "—";
  }
  if (beat === "analyse") {
    if (relation === "current") return analysisDone ? "just done" : "writing";
    if (relation === "past") return "done";
    return "opens when Gather is done";
  }
  if (beat === "discuss") {
    if (relation === "current") return "in conversation";
    if (relation === "past") return "done";
    return "opens when the first take lands";
  }
  // live
  if (relation === "current") {
    if (ctx.subStep && ctx.subStep.canvasKey === "picture" && ctx.subStep.beat === "live") {
      const at = ctx.subStep.agreedAt ?? ctx.subStep.startedAt;
      return at ? `agreed ${formatDate(at as unknown as string)}` : "agreed";
    }
    return "agreed";
  }
  if (relation === "past") return "superseded";
  return "pending your sign-off";
}

function analysisStatus(beat: Beat, relation: BeatRelation, ctx: NavContext): string {
  if (beat === "gather") {
    if (relation === "current") return "pulling it in";
    if (relation === "past") return "done";
    return "starts when you agree your picture";
  }
  if (beat === "analyse") {
    if (relation === "current") return ctx.draft?.status === "ready" || ctx.draft?.status === "agreed" ? "just done" : "thinking";
    if (relation === "past") return "done";
    return "opens when pulled in";
  }
  if (beat === "discuss") {
    if (relation === "current") return "refining together";
    if (relation === "past") return "done";
    return "opens when ready";
  }
  // live
  if (relation === "current") {
    const at = ctx.draft?.agreedAt ?? ctx.subStep?.agreedAt ?? null;
    return at ? `agreed ${formatDate(at as unknown as string)}` : "agreed";
  }
  if (relation === "past") return "superseded";
  return "pending your sign-off";
}

function planStatus(beat: Beat): string {
  if (beat === "live") return "pending your sign-off";
  return "opens after analysis is agreed";
}

function progressStatus(_beat: Beat): string {
  return "wakes up once you have a plan in motion";
}
