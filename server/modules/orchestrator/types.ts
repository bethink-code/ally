// Orchestrator interface contracts.
//
// One Orchestrator type, instantiated per (phase, step, instance) — 16 base
// instances across the four phases. Every transition the user can trigger
// (chat turn, UI action, phase boundary) goes through an orchestrator.
//
// See ../../../Scratch/orchestrator_architecture_plan.md for design rationale.
//
// Four responsibilities (from the plan doc):
//   KNOWING   — where am I, what state, what rules apply
//   DOING     — classify input, commit changes, fire transitions, run the work
//   BRIDGING  — chat ↔ artefact symmetry, phase handoffs
//   SURFACING — public state, visible to user at all times

import type { OrchestratorState } from "./state";

// --- Inputs the orchestrator accepts ---------------------------------------

// A chat turn from the user. The orchestrator owns classification — does
// this turn describe the artefact, propose a structural change, signal
// agreement, or just orient? The chat LLM can suggest the classification,
// but the orchestrator decides.
export type ChatTurn = {
  userMessage: string;
  conversationContext?: unknown; // history, profile, flags — phase-specific
};

// A UI action: button click, tab navigation, agreement submission. The
// orchestrator validates whether this action is allowed in the current state
// and what to do with it.
export type UiAction =
  | { kind: "cta_click"; relation: "past" | "current" | "future" }
  | { kind: "agree" }
  | { kind: "reopen"; reason?: string }
  | { kind: "retry" }
  | { kind: "navigate_back" };

// --- Transition targets + preconditions ------------------------------------
//
// `TransitionTarget` is a domain-level operation (kickoff the work, agree
// the artefact, advance to next step, etc.), distinct from `UiAction` (which
// is UI-shape specific). Concrete orchestrators declare preconditions per
// transition target so business rules are checked BEFORE a UI action is
// even offered.
//
// Example: PictureDiscussOrchestrator's `agree` requires the analysis to
// be `done`, the checklist to have all critical items covered, and no
// unresolved flagged issues. The orchestrator reports those gates back as
// a `PreconditionResult` so the UI can render "you need to discuss X, Y,
// Z before agreeing" rather than just disabling a button silently.

export type TransitionTarget =
  | { kind: "kickoff" } // start the step's work from idle
  | { kind: "agree" } // user signs off — this artefact is right
  | { kind: "advance" } // move to next step (often automatic on done)
  | { kind: "reopen"; reason?: string } // re-open a previously agreed step
  | { kind: "retry" }; // explicit retry after failure

export type Precondition = {
  // Stable identifier for the precondition. Used by the UI to map to copy
  // and by tests to assert specific gates.
  code: string;
  // User-facing summary of what's missing or required.
  message: string;
  // Optional: the action the user (or admin) should take to resolve. Drives
  // a CTA on the blocked UI surface.
  resolveAction?: string;
};

export type PreconditionResult =
  | { satisfied: true }
  | { satisfied: false; failed: Precondition[] };

// A phase boundary signal. When one phase's `live` step agrees, the
// next phase's `gather` step's orchestrator gets handed control with
// the prior artefact + agreement context.
export type PhaseHandoff = {
  fromPhase: string;
  toPhase: string;
  artefactRef: string; // pointer to the agreed artefact
  agreedAt: Date;
};

// --- Outputs from orchestrator method calls --------------------------------

// Classification of a chat turn. Drives what the orchestrator does next.
export type ChatTurnClassification =
  | { kind: "description"; topic?: string } // user asks about the artefact
  | { kind: "rule"; rule: ProposedRule } // user proposes a structural change
  | { kind: "agreement"; target: string } // user signals "this is right"
  | { kind: "orientation"; intent: string }; // user signals reorient / confused

// A proposed rule from the chat. Translates to a row in `reinterpretations`.
// Same shape as the existing reinterpretation rule, surfaced explicitly here
// because the chat is the SOURCE of new rules going forward.
export type ProposedRule = {
  subject: string;
  effect: "include" | "exclude";
  predicateKind: string;
  predicate: unknown;
  rationale: string;
};

// What the orchestrator did with a chat turn. The chat surface uses this to
// render Ally's reply and acknowledge any artefact change.
export type ChatTurnResult = {
  classification: ChatTurnClassification;
  // Ally's reply text, narrating what the orchestrator did. NEVER promises
  // a behaviour the orchestrator didn't actually perform.
  reply: string;
  // Human-readable summary of any state change the orchestrator made as a
  // result of this turn (rule committed, transition fired, etc.). Empty if
  // the turn was descriptive-only.
  stateChangeNote: string | null;
  // The new state after the turn was processed.
  newState: OrchestratorState;
};

// What the orchestrator did with a UI action. The action bar / step landing
// uses this to decide what to render next (transition into work surface,
// stay on current view, show error, etc.).
export type UiActionResult = {
  accepted: boolean;
  // If rejected, why — surfaced to the user.
  reason?: string;
  // The new state after the action was processed (if accepted).
  newState: OrchestratorState;
  // Hints to the UI about what to do next (e.g. navigate to a different
  // sub-view). Optional — the orchestrator's state should be enough most
  // of the time.
  uiHint?: { kind: "navigate"; target: string };
};

// --- The orchestrator interface --------------------------------------------
//
// Every concrete orchestrator (PictureGather, PictureDraft, PictureDiscuss,
// PictureLive, AnalysisGather, AnalysisDraft, …) implements this. Methods
// are async because every meaningful operation hits the DB and possibly
// external services (LLM, queue).

export interface Orchestrator {
  // --- Identity ---
  readonly userId: string;
  readonly subStepId: number;

  // --- KNOWING ---

  // Current public state. The single source of truth — the UI subscribes to
  // this. Returned by the GET endpoint that the front-end polls.
  getState(): Promise<OrchestratorState>;

  // Whether a given UI action is valid in the current state. Used by the
  // UI to enable/disable controls without trial-and-error. Status-machine
  // shape only — for business preconditions use canTransition().
  canDo(action: UiAction): Promise<boolean>;

  // Rich precondition check for a domain-level transition. Returns
  // satisfied=true OR a list of failed preconditions, each with a user-
  // facing message and (where applicable) the resolve action. The UI
  // uses this to render "you need to discuss X, Y, Z before agreeing"
  // rather than just disabling a button silently.
  //
  // ALL transitions go through this before the orchestrator commits.
  // The transition() side firing a target without a satisfied=true
  // canTransition() check is a programming error.
  canTransition(target: TransitionTarget): Promise<PreconditionResult>;

  // --- DOING ---

  // Execute this step's work. For draft steps this is the LLM analysis pass.
  // For gather it's the file-extraction pipeline. For live it's a no-op
  // (or a sync-with-record). MUST be safe to call multiple times — usually
  // dispatches to the queue if work is needed and idempotently no-ops if
  // already in flight.
  run(): Promise<void>;

  // Process a chat turn. Classifies, optionally commits a rule, generates
  // Ally's reply that narrates what happened. Atomic — if classification
  // says rule-commit, the rule is persisted and reflected in state before
  // returning.
  onChatTurn(turn: ChatTurn): Promise<ChatTurnResult>;

  // Process a UI action. Validates, optionally fires a transition, returns
  // the new state. Idempotent for actions that ask for state already true.
  onUiAction(action: UiAction): Promise<UiActionResult>;

  // --- BRIDGING ---

  // Phase boundary: hand off to another orchestrator. Only meaningful when
  // this orchestrator is at status=done and the next phase's gather step
  // needs to be initialised. The handoff returns the next orchestrator's
  // initial state.
  handoffTo(next: PhaseHandoff): Promise<OrchestratorState>;
}

// --- Static metadata for an orchestrator type ------------------------------
//
// Each concrete orchestrator class exposes this alongside the instance
// methods so the registry can look up "what's the orchestrator for
// (phase, step)" without instantiating it.

export type OrchestratorMeta = {
  phase: string;
  step: string;
  // Driver of this step (per the architecture spec):
  //   "person" — the user does the work (e.g., uploading)
  //   "ally" — the system does it (LLM call, computation)
  //   "both" — collaborative (chat-driven refinement)
  driver: "person" | "ally" | "both";
  // Whether this step has a long-running work pass that should go to a
  // durable queue. Drives whether `run()` enqueues vs runs inline.
  hasQueuedWork: boolean;
};
