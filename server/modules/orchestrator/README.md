# Orchestrator module

Phase A foundation for the Phases × Steps × Orchestrators architecture
described in `Scratch/orchestrator_architecture_plan.md`. **Read that file
first** if you don't have context.

## What's in this module

```
state.ts       — OrchestratorState shape, status enum, pure mutators
types.ts       — public interface contracts: ChatTurn, UiAction, etc.
base.ts        — abstract BaseOrchestrator class (shared machinery)
README.md      — this file
```

## What's NOT in this module yet

- Concrete orchestrators per (phase, step) — `PictureDraftOrchestrator` is
  the first one to build (Phase A reference impl, separate PR)
- Queue integration (Inngest or chosen alternative — pending Garth's
  decision)
- The `orchestrator_state` jsonb column on `sub_steps` — will arrive with
  the first concrete orchestrator's PR
- A registry that maps `(phase, step)` → orchestrator class — added as soon
  as we have two concrete orchestrators

## Status mapping during the bridge period

While the schema migration to `sub_steps.orchestrator_state` jsonb hasn't
shipped, the base class hydrates state from the existing `sub_steps`
columns and writes back to them. See `mapLegacyStatus` / `mapToLegacyStatus`
in `base.ts`. This is a temporary shim — once the column lands the bridge
goes away.

```
   sub_steps.status      ↔  OrchestratorStatus
   not_started           →  idle
   in_progress (no err)  →  working
   in_progress (err)     →  failed
   agreed                →  done
   paused                →  waiting
   superseded            →  done
```

## How to add a new concrete orchestrator

1. Create `server/modules/orchestrator/<phase><Step>.ts`, e.g.
   `pictureDraft.ts`.
2. Extend `BaseOrchestrator`. Provide:
   - `meta` with phase, step, driver, hasQueuedWork
   - `run()` — what this step's work is
   - `onChatTurn()` — classification + reply
   - `onUiAction()` — validate and respond to UI actions
   - `handoffTo()` — phase-boundary logic (often a no-op for non-live steps)
3. Override `computeHistoricalP50()` if you have a prior duration model
   for this step kind.
4. Override `isActionAllowed()` if the default action validity isn't right
   for this step.
5. Register in the orchestrator registry (TBD; will be a static map keyed
   by `${phase}/${step}`).

## Design rules

1. **The state is the single public surface.** Nothing other than the
   orchestrator mutates it. The chat reads it. The UI reads it. They send
   commands back through the orchestrator's methods.

2. **Every status transition goes through `transitionStatus()`** so the
   audit history is complete and illegal transitions throw loudly. Every
   transition also writes to `audit_logs` via `transitionTo()` (queryable
   by `resourceType='orchestrator'`, `resourceId='<phase>/<step>/<id>'`).

3. **The orchestrator is the only thing that knows the rules.** Validation
   logic, transition-validity, what's-blocking — all live here. The chat
   doesn't decide; the UI doesn't decide. They ask.

4. **Two layers of validation:**
   - `canDo(action)` — boolean status-shape check for UI button enabling
   - `canTransition(target)` — rich precondition check returning the list
     of *failed* preconditions with user-facing messages and resolve
     actions. Use this before firing any domain transition (kickoff /
     agree / advance / reopen / retry).

5. **Failure is a first-class status with a typed catalogue.** When work
   fails, the orchestrator transitions to `failed` (or `recovering` if a
   retry will help) with a `failure` object built from `FAILURE_CODES`.
   The catalogue is in `state.ts`; new codes added pragmatically as we
   encounter real failure modes. Each carries a `kind`
   (user_resolvable | transient | system | permanent), `recoverable`,
   `message`, optional `adminMessage` for support context.

6. **`run()` is idempotent.** Concrete orchestrators must check whether
   work is already in flight before starting. Re-running `run()` on a
   `working` status should be a no-op or a status check, not a duplicate
   execution.

7. **State narration is part of the contract.** Every transition sets
   `message` to something a user can read. Concrete orchestrators provide
   step-specific copy ("I'm reading your year, Beryl…" — not the bridge
   default "Working on picture draft…").

8. **Reportable.** `/api/orchestrator/<phase>/<step>/<subStepId>/report`
   returns `{ state, preconditions, auditLog }` for support tooling and
   admin debugging. Pass `?includeArtefact=1` for the full artefact
   payload (heavy; only when needed).

## What's coming in subsequent PRs

- **Phase A.2**: Migration adds `sub_steps.orchestrator_state` jsonb column.
  Bridge code in `base.ts` is replaced with direct read/write.

- **Phase A.3**: Queue integration (Inngest or chosen alternative). `run()`
  in concrete orchestrators dispatches durable jobs. Status flips to
  `working` synchronously, then `done` when the job completes (event-driven).

- **Phase A.4**: `PictureDraftOrchestrator` as the reference implementation.
  Absorbs `refreshCanvas1Analysis`, `runPictureAnalyse`, the work-kickoff
  scattering. End-to-end through the orchestrator pattern.

- **Phase A.5**: `/api/orchestrator/:subStepId/state` endpoint that the UI
  polls. Replaces the in-progress endpoint we shipped today.

- **Phase B+**: Picture phase full (4 orchestrators), then Analysis phase,
  then schema cleanup, then spec rewrite. See the plan doc.
