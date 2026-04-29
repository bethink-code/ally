// Orchestrator state model.
//
// The state is the single public surface of every orchestrator. Both the chat
// pane and the artefact pane subscribe to it. AllyAtWork is the rendering of
// `status=working`. The chat opener varies with status. The action bar's
// available buttons come from what's valid given the status.
//
// THE STATE IS THE PROMISE TO THE USER:
//   • that the system is honest about what it's doing
//   • that the user is never alone with the system
//   • that failure surfaces and recovers, never silently rots
//
// Mutating the state is exclusively the orchestrator's job. Nothing else
// touches it. The chat and the artefact READ it; commands flow back through
// the orchestrator's methods.

// Phase + Step taxonomies are owned here — orchestrator is server-side and
// shouldn't import from `client/src/`. The client's `lib/canvasCopy.ts`
// exports a parallel `PhaseKey` for the UI; the values must stay in sync.
// (In Phase D we collapse these into one shared definition in
// `shared/`.)

export const PHASE_KEYS = ["picture", "analysis", "plan", "progress"] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export const STEP_KEYS = ["gather", "draft", "discuss", "live"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

// --- Status (the most important enum in the system) ------------------------
//
// Keep the list small. Every status maps to a defined visual treatment in the
// UI and a defined chat-side voice. Adding a status is a product decision, not
// a technical one — discuss before adding.

export const ORCHESTRATOR_STATUSES = [
  "idle", // Ready. Awaiting user input or upstream signal. Quiet UI.
  "working", // Doing the step's work (LLM call, queued job, etc.). AllyAtWork rendering.
  "waiting", // Awaiting a specific input/condition. Tells user what & why.
  "blocked", // Precondition unmet (e.g. no statements). Tells user what's needed.
  "done", // Step complete. Artefact ready, or the step has been agreed.
  "failed", // Permanent failure. User/admin intervention required.
  "recovering", // Last attempt failed; retrying. Visible to user.
] as const;

export type OrchestratorStatus = (typeof ORCHESTRATOR_STATUSES)[number];

// --- Failure catalogue ------------------------------------------------------
//
// The kind discriminates how a failure should be handled:
//   user_resolvable — user can fix it (upload a missing statement, agree
//                     a precondition, etc.). UI surfaces with action.
//   transient       — system error, queue will retry. UI shows
//                     "trying again" without alarming.
//   system          — system error not auto-retrying (e.g. configuration
//                     missing). Surfaces as failed; admin must intervene.
//   permanent       — irreversible failure for this attempt (e.g. content
//                     policy violation). Need to start fresh.
//
// FAILURE_CODES is intentionally pragmatic: codes are added as we encounter
// real failure modes, not pre-enumerated up front. Each has a kind, a default
// recoverable flag, and a default user-facing message that concrete
// orchestrators can override.

export type FailureKind = "user_resolvable" | "transient" | "system" | "permanent";

export const FAILURE_CODES = {
  // Orchestrator preconditions (user_resolvable) ------------------------------
  no_statements: {
    kind: "user_resolvable" as FailureKind,
    recoverable: false, // user must act first
    defaultMessage: "I need at least one bank statement before I can read your year.",
  },
  unresolved_flagged_issues: {
    kind: "user_resolvable" as FailureKind,
    recoverable: false,
    defaultMessage: "We've got a few things still to talk through before we agree this.",
  },
  checklist_incomplete: {
    kind: "user_resolvable" as FailureKind,
    recoverable: false,
    defaultMessage: "There are still some topics we haven't covered.",
  },

  // System preconditions (system) ---------------------------------------------
  no_active_prompt: {
    kind: "system" as FailureKind,
    recoverable: false,
    defaultMessage: "I'm not configured to do this work right now. Try again shortly.",
  },

  // Anthropic / LLM (mostly transient) ----------------------------------------
  anthropic_timeout: {
    kind: "transient" as FailureKind,
    recoverable: true,
    defaultMessage: "Reading your statements is taking longer than usual — trying again.",
  },
  anthropic_rate_limit: {
    kind: "transient" as FailureKind,
    recoverable: true,
    defaultMessage: "I'm temporarily over my limit. Trying again shortly.",
  },
  anthropic_parse_failed: {
    kind: "transient" as FailureKind,
    recoverable: true,
    defaultMessage: "The reading didn't come back in a usable shape. Trying again.",
  },
  anthropic_max_tokens: {
    kind: "permanent" as FailureKind,
    recoverable: false,
    defaultMessage: "I have too much to say and ran out of room. This needs a configuration change.",
  },

  // Generic catch-all ---------------------------------------------------------
  unknown_error: {
    kind: "system" as FailureKind,
    recoverable: true,
    defaultMessage: "Something went wrong. I'll try again.",
  },
} as const;

export type FailureCode = keyof typeof FAILURE_CODES;

// --- The state shape -------------------------------------------------------

export type OrchestratorState = {
  // --- Where we are ---
  phase: PhaseKey;
  step: StepKey;
  instance: number; // re-entry counter; matches sub_steps.instance

  // --- Public status (THE thing the UI subscribes to) ---
  status: OrchestratorStatus;

  // Human-readable summary of what's happening right now. This is what
  // Ally says ("I'm reading your year, Beryl…"); what AllyAtWork's title
  // shows; what the action bar's caption reflects. ALWAYS non-empty.
  message: string;

  // --- Timing (the user is never confused about how long) ---

  // When the current state began. For `working` this is the kick-off
  // timestamp; for `waiting`/`blocked` it's when the orchestrator entered
  // the holding pattern.
  startedAt: Date | null;

  // Honest ETA: historical p50 for this (phase, step) — for this user if
  // we have priors, otherwise the cohort median. Null when we genuinely
  // don't know (first run on this step, ever).
  expectedDurationS: number | null;

  // Multi-stage work: "Stage 2/3: writing prose". null for single-stage
  // operations.
  stage: { current: number; total: number; label: string } | null;

  // --- Holding patterns (what's the orchestrator waiting for) ---

  // status=waiting: orchestrator is holding for a specific input or upstream
  // signal. `what` describes what we're waiting for; `action` describes
  // what the user can do to unblock (often "say X in chat" or "click Y").
  waitingOn: { what: string; action: string } | null;

  // status=blocked: a precondition is not met. The orchestrator can't proceed
  // until it is. `reason` is the diagnostic; `neededAction` is what the user
  // (or admin) must do.
  blockedBy: { reason: string; neededAction: string } | null;

  // --- Failure (when things break, they break visibly) ---

  // status=failed or status=recovering: the last attempt failed. The shape
  // is designed so downstream code (UI, support tooling, queue retry logic)
  // can switch on `code` without parsing a free-form string. See FAILURE_CODES
  // for the catalogue and each code's default kind/recoverable/message.
  failure: {
    code: FailureCode | string; // FailureCode catalogue value when known; string for unknown
    kind: FailureKind;
    recoverable: boolean;
    message: string; // user-facing explanation (catalogue default or override)
    adminMessage?: string; // additional context for support
    retryToken?: string; // queue's retry handle
    occurredAt: Date;
    retryCount: number; // accumulates across recovering attempts
  } | null;

  // --- Audit ---

  // Append-only log of state transitions for this orchestrator instance.
  // Used by the support tooling and by the orchestrator itself to make
  // recovery decisions ("I've already retried this twice, escalate").
  history: Array<{
    timestamp: Date;
    status: OrchestratorStatus;
    event: string; // short event name; not a long narrative
  }>;
};

// --- Initial state factory -------------------------------------------------

export function newOrchestratorState(input: {
  phase: PhaseKey;
  step: StepKey;
  instance: number;
}): OrchestratorState {
  return {
    phase: input.phase,
    step: input.step,
    instance: input.instance,
    status: "idle",
    message: "Ready.",
    startedAt: null,
    expectedDurationS: null,
    stage: null,
    waitingOn: null,
    blockedBy: null,
    failure: null,
    history: [],
  };
}

// --- Status validity rules -------------------------------------------------
//
// Not every status transition is legal. The orchestrator's transition()
// method MUST go through this guard.

const VALID_TRANSITIONS: Record<OrchestratorStatus, OrchestratorStatus[]> = {
  idle: ["working", "waiting", "blocked"],
  working: ["done", "failed", "recovering", "waiting"],
  waiting: ["working", "idle", "blocked"],
  blocked: ["idle", "working"],
  recovering: ["working", "failed"],
  done: ["working", "idle"], // re-entry: a re-opened beat goes back to working
  failed: ["working"], // explicit retry
};

export function canTransitionStatus(
  from: OrchestratorStatus,
  to: OrchestratorStatus,
): boolean {
  if (from === to) return true; // no-op is always legal
  return VALID_TRANSITIONS[from].includes(to);
}

// --- Pure state mutators ---------------------------------------------------
//
// All state changes go through one of these. Each returns a new state object;
// the orchestrator's job is to persist it. This keeps state mutation auditable
// and testable in isolation.

export function transitionStatus(
  state: OrchestratorState,
  next: OrchestratorStatus,
  message: string,
  event: string,
): OrchestratorState {
  if (!canTransitionStatus(state.status, next)) {
    throw new Error(
      `Illegal status transition: ${state.status} → ${next} (event: ${event})`,
    );
  }
  return {
    ...state,
    status: next,
    message,
    startedAt: next === "working" || next === "waiting" || next === "blocked"
      ? new Date()
      : state.startedAt,
    history: [...state.history, { timestamp: new Date(), status: next, event }],
  };
}

export function setStage(
  state: OrchestratorState,
  current: number,
  total: number,
  label: string,
): OrchestratorState {
  return { ...state, stage: { current, total, label } };
}

export function clearStage(state: OrchestratorState): OrchestratorState {
  return { ...state, stage: null };
}

export function setWaitingOn(
  state: OrchestratorState,
  what: string,
  action: string,
): OrchestratorState {
  return { ...state, waitingOn: { what, action } };
}

export function setBlockedBy(
  state: OrchestratorState,
  reason: string,
  neededAction: string,
): OrchestratorState {
  return { ...state, blockedBy: { reason, neededAction } };
}

export function setFailure(
  state: OrchestratorState,
  failure: NonNullable<OrchestratorState["failure"]>,
): OrchestratorState {
  return { ...state, failure };
}

/**
 * Build a failure object from a catalogue code. Caller can override message
 * or supply admin-only context. retryCount carries forward from prior failure
 * (or starts at 1 for the first occurrence).
 */
export function buildFailure(
  code: FailureCode,
  options: {
    messageOverride?: string;
    adminMessage?: string;
    retryToken?: string;
    priorRetryCount?: number;
  } = {},
): NonNullable<OrchestratorState["failure"]> {
  const cat = FAILURE_CODES[code];
  return {
    code,
    kind: cat.kind,
    recoverable: cat.recoverable,
    message: options.messageOverride ?? cat.defaultMessage,
    adminMessage: options.adminMessage,
    retryToken: options.retryToken,
    occurredAt: new Date(),
    retryCount: (options.priorRetryCount ?? 0) + 1,
  };
}

export function setExpectedDuration(
  state: OrchestratorState,
  seconds: number,
): OrchestratorState {
  return { ...state, expectedDurationS: seconds };
}
