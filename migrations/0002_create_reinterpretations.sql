-- Migration 0002: Create reinterpretations table.
--
-- First-class primitive for "you misinterpreted my data; categorise it like
-- this instead." Distinct from claims/profile narratives because rules are
-- STRUCTURED — analysis pipeline applies them deterministically before the
-- LLM narrates. Same data + new rule → new picture.
--
-- See server/modules/reinterpretation/{schema,apply}.ts for the rule shape
-- and the pure-function applier; shared/schema.ts for the table definition
-- and column-level documentation.
--
-- Rollback (if needed):
--   DROP TABLE reinterpretations;

BEGIN;

CREATE TABLE reinterpretations (
  id                serial PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users(id),
  subject           text NOT NULL,
  effect            text NOT NULL,
  predicate_kind    text NOT NULL,
  predicate         jsonb NOT NULL,
  rationale         text NOT NULL,
  source            text NOT NULL DEFAULT 'user_correction',
  source_message_id integer,
  status            text NOT NULL DEFAULT 'active',
  superseded_by     integer,
  superseded_at     timestamp,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_reinterpretations_user
  ON reinterpretations (user_id);

CREATE INDEX idx_reinterpretations_user_active
  ON reinterpretations (user_id, status);

COMMIT;
