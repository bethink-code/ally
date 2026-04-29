import type { Rule } from "./schema";

// Pure function: given raw transactions + active rules, produce
//   - per-transaction subject tags (which subject(s) each tx belongs to)
//   - per-subject aggregates (deterministic numbers — sum, count, samples)
//
// The point: the LLM downstream sees the aggregates as known facts, not
// estimates. It narrates around deterministic numbers it can't fudge.
//
// Rule semantics: a transaction is a member of a subject if AT LEAST ONE
// `include` rule for that subject matches AND NO `exclude` rule for that
// subject matches. Subjects are independent — a tx can belong to many.

export type Tx = {
  date: string;
  description: string;
  amount: number;
  direction: "credit" | "debit";
  // Caller may pass any extra context through; pure function ignores it.
  // Used by the integration layer to keep statement-of-origin.
  statementFile?: string;
};

export type CategorisedTx = Tx & {
  subjects: string[]; // subject paths the tx ended up tagged with
  appliedRuleIds: number[]; // rule ids that contributed to the tagging
};

export type SubjectAggregate = {
  subject: string;
  totalCredits: number;
  totalDebits: number;
  netFlow: number; // credits - debits
  count: number;
  countCredits: number;
  countDebits: number;
  // First N matching transactions, for the LLM to quote/narrate accurately.
  samples: Tx[];
  // Rule rationales attached to this subject — gives the LLM the human reason.
  rationales: string[];
};

export type ApplyOutput = {
  categorised: CategorisedTx[];
  aggregatesBySubject: Record<string, SubjectAggregate>;
};

const SAMPLE_LIMIT = 8;

export function applyReinterpretations(transactions: Tx[], rules: Rule[]): ApplyOutput {
  // Index rules by subject for quick lookup.
  const rulesBySubject = new Map<string, { includes: Rule[]; excludes: Rule[] }>();
  for (const r of rules) {
    const bucket = rulesBySubject.get(r.subject) ?? { includes: [], excludes: [] };
    if (r.effect === "include") bucket.includes.push(r);
    else bucket.excludes.push(r);
    rulesBySubject.set(r.subject, bucket);
  }

  const categorised: CategorisedTx[] = transactions.map((t) => ({
    ...t,
    subjects: [],
    appliedRuleIds: [],
  }));

  // For each subject, walk transactions: in if any include matches AND no exclude matches.
  // O(rules × tx) — fine for our scale.
  for (const [subject, bucket] of rulesBySubject) {
    for (const tx of categorised) {
      const includeHit = bucket.includes.find((r) => matchesPredicate(tx, r));
      if (!includeHit) continue;
      const excludeHit = bucket.excludes.find((r) => matchesPredicate(tx, r));
      if (excludeHit) continue;
      tx.subjects.push(subject);
      if (includeHit.id != null) tx.appliedRuleIds.push(includeHit.id);
    }
  }

  // Aggregate per subject.
  const aggregatesBySubject: Record<string, SubjectAggregate> = {};
  for (const [subject, bucket] of rulesBySubject) {
    const agg: SubjectAggregate = {
      subject,
      totalCredits: 0,
      totalDebits: 0,
      netFlow: 0,
      count: 0,
      countCredits: 0,
      countDebits: 0,
      samples: [],
      rationales: [...bucket.includes, ...bucket.excludes].map((r) => r.rationale),
    };
    for (const tx of categorised) {
      if (!tx.subjects.includes(subject)) continue;
      agg.count += 1;
      if (tx.direction === "credit") {
        agg.totalCredits += tx.amount;
        agg.countCredits += 1;
      } else {
        agg.totalDebits += tx.amount;
        agg.countDebits += 1;
      }
      if (agg.samples.length < SAMPLE_LIMIT) {
        agg.samples.push({ date: tx.date, description: tx.description, amount: tx.amount, direction: tx.direction });
      }
    }
    agg.netFlow = agg.totalCredits - agg.totalDebits;
    aggregatesBySubject[subject] = agg;
  }

  return { categorised, aggregatesBySubject };
}

// --- Predicate evaluation ---------------------------------------------------
//
// Pure, switch-on-kind. Adding a new predicate kind = new case here +
// matching schema entry in schema.ts.

function matchesPredicate(tx: Tx, rule: Rule): boolean {
  switch (rule.predicateKind) {
    case "credits_matching": {
      if (tx.direction !== "credit") return false;
      const flags = rule.predicate.flags ?? "i";
      try {
        return new RegExp(rule.predicate.pattern, flags).test(tx.description);
      } catch {
        return false;
      }
    }
    case "debits_matching": {
      if (tx.direction !== "debit") return false;
      const flags = rule.predicate.flags ?? "i";
      try {
        return new RegExp(rule.predicate.pattern, flags).test(tx.description);
      } catch {
        return false;
      }
    }
    case "amount_in_range": {
      const { min, max, direction } = rule.predicate;
      if (direction && tx.direction !== direction) return false;
      if (min != null && tx.amount < min) return false;
      if (max != null && tx.amount > max) return false;
      return true;
    }
    case "date_in_range": {
      const { from, to } = rule.predicate;
      if (from && tx.date < from) return false;
      if (to && tx.date > to) return false;
      return true;
    }
  }
}

// --- LLM-friendly summary ---------------------------------------------------
//
// Render aggregates as a compact string the analysis prompt can include in
// its user message. Keeps the deterministic numbers visible to the LLM as
// authoritative — much harder to fudge than free-form narrative.

export function formatAggregatesForPrompt(aggregates: Record<string, SubjectAggregate>): string {
  const subjects = Object.values(aggregates).sort((a, b) => b.netFlow - a.netFlow || a.subject.localeCompare(b.subject));
  if (subjects.length === 0) return "(no reinterpretation rules active)";

  const lines: string[] = [
    "## Authoritative subject aggregates (computed from raw transactions per active reinterpretation rules)",
    "",
    "These numbers are the source of truth for the listed subjects. Use them verbatim in the picture.",
    "Don't recompute, don't average, don't round in ways that change the figure.",
    "",
  ];
  for (const a of subjects) {
    lines.push(`### ${a.subject}`);
    lines.push(`- credits total: ${a.totalCredits.toFixed(2)} across ${a.countCredits} transaction(s)`);
    if (a.countDebits > 0) {
      lines.push(`- debits total: ${a.totalDebits.toFixed(2)} across ${a.countDebits} transaction(s)`);
      lines.push(`- net flow: ${a.netFlow.toFixed(2)}`);
    }
    if (a.rationales.length > 0) {
      lines.push(`- rationale(s):`);
      for (const r of a.rationales) lines.push(`  - ${r}`);
    }
    if (a.samples.length > 0) {
      lines.push(`- sample transactions (up to ${SAMPLE_LIMIT}):`);
      for (const s of a.samples) {
        lines.push(`  - ${s.date}  ${s.direction === "credit" ? "+" : "-"}${s.amount.toFixed(2)}  ${s.description}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
