import { z } from "zod";

// Reinterpretation rule shape.
//
// Storage shape (in DB): one row per rule, with `predicateKind` + `predicate`
// jsonb. This file defines the validation schemas for each predicate kind, so
// rules read from the DB can be parsed into typed unions before the apply
// function runs.
//
// Adding a new predicate kind:
//   1. Add a new branch to predicateSchema below
//   2. Add a matching case in apply.ts:matchesPredicate
//   3. Existing rules continue to work — kinds are open-ended strings in the
//      DB, the parser just rejects unknown kinds at load time.

// --- Predicate kinds ---------------------------------------------------------

const creditsMatchingSchema = z.object({
  pattern: z.string().min(1).describe("Regex matched against transaction.description"),
  flags: z.string().optional().describe("Regex flags. Defaults to 'i' (case-insensitive)."),
});

const debitsMatchingSchema = z.object({
  pattern: z.string().min(1),
  flags: z.string().optional(),
});

const amountInRangeSchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  direction: z.enum(["credit", "debit"]).optional(),
});

const dateInRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// --- The rule (combined kind + predicate) -----------------------------------

export const PREDICATE_KINDS = [
  "credits_matching",
  "debits_matching",
  "amount_in_range",
  "date_in_range",
] as const;

export type PredicateKind = (typeof PREDICATE_KINDS)[number];

export const ruleSchema = z.discriminatedUnion("predicateKind", [
  z.object({
    id: z.number().optional(),
    subject: z.string().min(1),
    effect: z.enum(["include", "exclude"]),
    rationale: z.string(),
    predicateKind: z.literal("credits_matching"),
    predicate: creditsMatchingSchema,
  }),
  z.object({
    id: z.number().optional(),
    subject: z.string().min(1),
    effect: z.enum(["include", "exclude"]),
    rationale: z.string(),
    predicateKind: z.literal("debits_matching"),
    predicate: debitsMatchingSchema,
  }),
  z.object({
    id: z.number().optional(),
    subject: z.string().min(1),
    effect: z.enum(["include", "exclude"]),
    rationale: z.string(),
    predicateKind: z.literal("amount_in_range"),
    predicate: amountInRangeSchema,
  }),
  z.object({
    id: z.number().optional(),
    subject: z.string().min(1),
    effect: z.enum(["include", "exclude"]),
    rationale: z.string(),
    predicateKind: z.literal("date_in_range"),
    predicate: dateInRangeSchema,
  }),
]);

export type Rule = z.infer<typeof ruleSchema>;

// --- DB row → typed Rule ----------------------------------------------------
//
// Loose parse: a DB row is a typed Reinterpretation, but its predicate column
// is `unknown`. parseRule re-validates so apply.ts can rely on shape per kind.
//
// Throws if the row's predicate doesn't match its kind. Caller decides whether
// to skip the row, fail the whole pipeline, or audit.

export function parseRule(row: {
  id?: number;
  subject: string;
  effect: string;
  rationale: string;
  predicateKind: string;
  predicate: unknown;
}): Rule {
  return ruleSchema.parse(row);
}
