// PictureDraftOrchestrator — the Phase A reference implementation.
//
// Owns the picture phase's draft step ("Reading you" — Ally writes the
// first-take story from the user's statements). This is the orchestrator
// pattern shipping for the first time against a real step.
//
// PHASE A SCOPE: this orchestrator wraps existing logic
// (refreshCanvas1Analysis) rather than absorbing it. Future PRs flatten the
// indirection — the orchestrator becomes the only entry point for kicking
// off / polling / reasoning about a picture-draft pass.
//
// State derivation (interim, until orchestrator_state jsonb migration ships):
//   - The orchestrator's status is computed from the latest `analyses` row
//     for this user. This is honest — that table is the source of truth for
//     "is the work in flight, done, or failed" today.
//   - Once the queue lands and we want richer state (waiting / blocked /
//     recovering with retry tokens), we move to a persisted jsonb column.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { analyses, statements } from "@shared/schema";
import { refreshCanvas1Analysis } from "../analysis/refresh";
import { getActivePrompt } from "../prompts/getPrompt";
import { BaseOrchestrator } from "./base";
import {
  type OrchestratorState,
  buildFailure,
  newOrchestratorState,
  setExpectedDuration,
  transitionStatus,
} from "./state";
import type {
  ChatTurn,
  ChatTurnResult,
  OrchestratorMeta,
  PhaseHandoff,
  Precondition,
  PreconditionResult,
  TransitionTarget,
  UiAction,
  UiActionResult,
} from "./types";

// Default ETA when we have no priors. Median across observed runs has been
// ~50-90s for a 12-month, ~40k input-token analysis. Concrete number used
// when no historical data is available for this user.
const DEFAULT_ETA_SECONDS = 75;

export class PictureDraftOrchestrator extends BaseOrchestrator {
  readonly meta: OrchestratorMeta = {
    phase: "picture",
    step: "draft",
    driver: "ally",
    hasQueuedWork: true,
  };

  // --- KNOWING ---------------------------------------------------------------
  //
  // Override the base hydrator: derive orchestrator state from the LATEST
  // analyses row for this user, not from sub_steps.status. The analyses
  // table is the source of truth for the work — sub_steps.status hasn't
  // historically reflected mid-flight state accurately.

  async getState(): Promise<OrchestratorState> {
    const [latest] = await db
      .select()
      .from(analyses)
      .where(eq(analyses.userId, this.userId))
      .orderBy(desc(analyses.createdAt))
      .limit(1);

    let state = newOrchestratorState({ phase: "picture", step: "draft", instance: 1 });

    if (!latest) {
      // No analysis ever — idle, ready to run.
      state = transitionStatus(state, "idle", "Ready to read your statements.", "init");
      state = setExpectedDuration(state, DEFAULT_ETA_SECONDS);
      return state;
    }

    const expected = await this.computeHistoricalP50(latest.userId).catch(() => null);
    state = setExpectedDuration(state, expected ?? DEFAULT_ETA_SECONDS);

    if (latest.status === "analysing") {
      state = transitionStatus(
        state,
        "working",
        "I'm reading your year. This usually takes about a minute.",
        `analysing (analysisId=${latest.id})`,
      );
      state.startedAt = latest.createdAt;
      // If we've been working far longer than expected, flag it without flipping
      // to failed — the user sees "still working" rather than silent over-run.
      const elapsedS = (Date.now() - new Date(latest.createdAt).getTime()) / 1000;
      const expectedS = state.expectedDurationS ?? DEFAULT_ETA_SECONDS;
      if (elapsedS > expectedS * 3) {
        state.message =
          "I'm still reading — this is taking longer than usual but I haven't hit a snag.";
      }
      return state;
    }

    if (latest.status === "failed") {
      state = transitionStatus(state, "failed", "I hit a snag.", `failed (analysisId=${latest.id})`);
      state.failure = buildFailure(
        classifyAnalysisError(latest.errorMessage),
        { messageOverride: latest.errorMessage ?? undefined },
      );
      return state;
    }

    // status === "done"
    state = transitionStatus(
      state,
      "done",
      "Read your year. Your first take is ready.",
      `done (analysisId=${latest.id})`,
    );
    state.startedAt = latest.completedAt ?? latest.createdAt;
    return state;
  }

  // Override historical-duration computation: query analyses table for this
  // user's prior completed runs and return the p50 duration. Falls back to
  // null when the user has no completed priors (caller uses default).
  protected async computeHistoricalP50(userId?: string): Promise<number | null> {
    const targetUser = userId ?? this.userId;
    const rows = await db
      .select({
        createdAt: analyses.createdAt,
        completedAt: analyses.completedAt,
      })
      .from(analyses)
      .where(and(eq(analyses.userId, targetUser), eq(analyses.status, "done")))
      .orderBy(desc(analyses.createdAt))
      .limit(10);
    const durations = rows
      .filter((r) => r.completedAt && r.createdAt)
      .map((r) => (new Date(r.completedAt!).getTime() - new Date(r.createdAt).getTime()) / 1000)
      .filter((d) => d > 0 && d < 600); // sanity bounds
    if (durations.length === 0) return null;
    durations.sort((a, b) => a - b);
    return Math.round(durations[Math.floor(durations.length / 2)]);
  }

  // --- KNOWING (continued): preconditions ------------------------------------
  //
  // Override the base canTransition() to add picture/draft's domain rules:
  //   kickoff → must have at least one extracted statement + an active
  //             analysis prompt; must not already be working
  //   retry  → must be currently failed (and not in a permanent failure mode)
  //   advance → must be done (only fires automatic step advance)
  //
  // We layer over `super.canTransition()` so the status-shape rules are
  // preserved; concrete preconditions add to the failed list.

  async canTransition(target: TransitionTarget): Promise<PreconditionResult> {
    const base = await super.canTransition(target);
    const failed: Precondition[] = base.satisfied ? [] : [...base.failed];

    if (target.kind === "kickoff") {
      const stmts = await db
        .select({ id: statements.id })
        .from(statements)
        .where(and(eq(statements.userId, this.userId), eq(statements.status, "extracted")));
      if (stmts.length === 0) {
        failed.push({
          code: "no_statements",
          message: "I need at least one bank statement to read your year.",
          resolveAction: "Upload a statement on the gather step.",
        });
      }

      const prompt = await getActivePrompt("analysis");
      if (!prompt) {
        failed.push({
          code: "no_active_prompt",
          message: "I'm not configured to do this work right now.",
          resolveAction: "Admin: activate an `analysis` prompt version.",
        });
      }
    }

    if (target.kind === "retry") {
      const state = await this.getState();
      if (state.failure && !state.failure.recoverable) {
        failed.push({
          code: "permanent_failure",
          message:
            state.failure.message ??
            "The last attempt hit a permanent issue — retrying won't help.",
          resolveAction: state.failure.adminMessage ?? "Admin attention needed.",
        });
      }
    }

    if (failed.length === 0) return { satisfied: true };
    return { satisfied: false, failed };
  }

  // --- DOING -----------------------------------------------------------------

  /**
   * Kick off a fresh picture-draft pass. Idempotent: if work is already in
   * flight, returns without spawning another. The actual work runs via
   * refreshCanvas1Analysis (existing fire-and-forget); the orchestrator's
   * state reflects the analyses-table progression.
   *
   * Called by:
   *   - the StepController CTA when the user clicks "See your first take" or
   *     "Carry on" on the picture/draft entry
   *   - the qa chat's auto-refresh hook when triggerRefresh fires
   *   - the sub-step background worker when picture/draft is the current step
   *     (during its initial entry from picture/gather)
   *
   * Returns when the kickoff has been accepted (analyses row inserted, IIFE
   * spawned) — does NOT wait for the work to complete.
   */
  async run(): Promise<void> {
    const current = await this.getState();
    if (current.status === "working" || current.status === "recovering") {
      // Already doing the work — no-op, return current state.
      return;
    }
    try {
      await refreshCanvas1Analysis(this.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      // refreshCanvas1Analysis throws on synchronous preconditions
      // (no_statements, no_active_analysis_prompt). Surface those as blocked,
      // not failed — they need user action, not a retry.
      const recoverable = !["no_statements", "no_active_analysis_prompt"].includes(message);
      // Best effort persistence — sub_steps schema doesn't yet have a
      // dedicated orchestrator-state column, so we lean on the next
      // getState() to surface the failure once an analyses row exists.
      // Re-throw so the caller (route, queue worker) can react.
      console.error("[PictureDraftOrchestrator.run] precondition failed:", message, "recoverable:", recoverable);
      throw err;
    }
  }

  /**
   * Picture-draft has no meaningful chat surface — chat lives on the
   * discuss step. Any chat turn arriving here is misrouted; respond with
   * an orientation reply rather than mutating state.
   */
  async onChatTurn(turn: ChatTurn): Promise<ChatTurnResult> {
    const state = await this.getState();
    return {
      classification: { kind: "orientation", intent: "misrouted_chat_during_draft" },
      reply:
        state.status === "working"
          ? "I'm reading your year right now — give me a moment and I'll be ready to talk it through."
          : "We can talk about this once I've finished reading. Open the conversation tab when the first take's ready.",
      stateChangeNote: null,
      newState: state,
    };
  }

  /**
   * UI actions valid on picture/draft:
   *   - cta_click (current relation): kick off run()
   *   - cta_click (past relation):    re-run with current rules
   *   - retry:                        explicit retry after failure
   *   - navigate_back:                always allowed
   * Other actions are rejected.
   */
  async onUiAction(action: UiAction): Promise<UiActionResult> {
    const state = await this.getState();
    const allowed = await this.canDo(action);
    if (!allowed) {
      return {
        accepted: false,
        reason: `${action.kind} not valid in status=${state.status}`,
        newState: state,
      };
    }
    switch (action.kind) {
      case "cta_click":
      case "retry": {
        await this.run();
        return { accepted: true, newState: await this.getState() };
      }
      case "navigate_back":
        return { accepted: true, newState: state };
      default:
        return {
          accepted: false,
          reason: `${action.kind} not handled by picture/draft orchestrator`,
          newState: state,
        };
    }
  }

  // --- BRIDGING --------------------------------------------------------------
  //
  // picture/draft → picture/discuss is internal to the picture phase; not a
  // phase boundary. The phase boundary handoff (picture → analysis) lives
  // on PictureLiveOrchestrator (when it ships in Phase B). For now this is
  // a no-op that throws — picture/draft never hands off to a different phase.

  async handoffTo(_next: PhaseHandoff): Promise<OrchestratorState> {
    throw new Error("PictureDraftOrchestrator does not perform phase boundary handoff");
  }
}

// --- Helpers ---------------------------------------------------------------
//
// Map an analyses.errorMessage string into a FailureCode. Best-effort —
// upstream callers (analyseStatements, refreshCanvas1Analysis) emit error
// strings that we recognise. Anything unrecognised falls into unknown_error,
// which is recoverable (we'll retry once via the queue when that lands).

import type { FailureCode } from "./state";

function classifyAnalysisError(message: string | null): FailureCode {
  if (!message) return "unknown_error";
  const m = message.toLowerCase();
  if (m.includes("no_statements")) return "no_statements";
  if (m.includes("no_active_analysis_prompt") || m.includes("no_active_prompt")) {
    return "no_active_prompt";
  }
  if (m.includes("rate") && m.includes("limit")) return "anthropic_rate_limit";
  if (m.includes("timeout") || m.includes("timed out")) return "anthropic_timeout";
  if (m.includes("max_tokens") || m.includes("unterminated") || m.includes("max tokens")) {
    return "anthropic_max_tokens";
  }
  if (m.includes("parse") || m.includes("structured output")) {
    return "anthropic_parse_failed";
  }
  return "unknown_error";
}
