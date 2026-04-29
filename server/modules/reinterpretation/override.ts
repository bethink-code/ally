import type { SubjectAggregate, Tx } from "./apply";

// Deterministic post-LLM override pass.
//
// The LLM is told (in the prompt) to use the per-subject aggregates verbatim.
// In practice it sometimes complies in prose ("R30k from The Herbal Horse")
// but populates the structured numeric fields (income.monthlyAverage,
// income.sources, etc.) from its own reading of the raw statements.
//
// This module fixes that by overwriting structured fields from aggregates
// AFTER the LLM call. The aggregates ARE the source of truth — narration
// stays as-is (the LLM's prose), numbers are deterministic.
//
// Shape we're patching:
//   result.income.monthlyAverage  (number | null)
//   result.income.sources         (incomeSourceSchema[])
//   result.spending.monthlyAverage
//   result.spending.byCategory    (categorySchema[])
//   result.savings.monthlyAverageSaved
//
// Strategy: for each top-level category with active rules, REPLACE the
// numeric headline + the breakdown entries from the deterministic aggregates.
// Categories with no rules are left alone (LLM's output stands).

type IncomeSource = { description: string; monthlyAverage: number; frequency: string };
type SpendingCategory = {
  category: string;
  monthlyAverage: number;
  percentOfSpend: number;
  examples: string[];
};

type AnalysisShape = {
  income?: {
    summary?: string;
    summaryAnnotations?: unknown[];
    monthlyAverage?: number | null;
    regularity?: "steady" | "variable" | "irregular";
    sources?: IncomeSource[];
  };
  spending?: {
    summary?: string;
    summaryAnnotations?: unknown[];
    monthlyAverage?: number | null;
    byCategory?: SpendingCategory[];
  };
  savings?: {
    summary?: string;
    summaryAnnotations?: unknown[];
    monthlyAverageSaved?: number | null;
    observation?: string;
  };
} & Record<string, unknown>;

export function overrideAnalysisResult(
  result: unknown,
  aggregates: Record<string, SubjectAggregate>,
  transactions: Tx[],
): unknown {
  if (!result || typeof result !== "object") return result;
  const r = { ...(result as AnalysisShape) };
  if (Object.keys(aggregates).length === 0) return r;

  const months = monthsCovered(transactions);
  if (months <= 0) return r;

  // Group subjects by top-level category.
  const byCategory: Record<string, SubjectAggregate[]> = {};
  for (const a of Object.values(aggregates)) {
    const cat = a.subject.split(".")[0];
    (byCategory[cat] ??= []).push(a);
  }

  if (byCategory.income && byCategory.income.length > 0) {
    r.income = applyIncomeOverride(r.income ?? {}, byCategory.income, months);
  }
  if (byCategory.spending && byCategory.spending.length > 0) {
    r.spending = applySpendingOverride(r.spending ?? {}, byCategory.spending, months);
  }
  if (byCategory.savings && byCategory.savings.length > 0) {
    r.savings = applySavingsOverride(r.savings ?? {}, byCategory.savings, months);
  }

  return r;
}

// --- Income ----------------------------------------------------------------
//
// monthlyAverage = sum across all income.* aggregates' totalCredits / months
// sources = one entry per subject (replaces LLM-emitted sources entirely —
//   when a user has stated rules, those rules ARE the income story)

function applyIncomeOverride(
  income: NonNullable<AnalysisShape["income"]>,
  aggs: SubjectAggregate[],
  months: number,
): AnalysisShape["income"] {
  const sources: IncomeSource[] = aggs.map((a) => ({
    description: deriveSourceDescription(a),
    monthlyAverage: round(a.totalCredits / months),
    frequency: deriveFrequency(a.countCredits, months),
  }));
  const totalMonthly = sources.reduce((sum, s) => sum + s.monthlyAverage, 0);

  return {
    ...income,
    monthlyAverage: totalMonthly,
    sources,
    // Regularity: if any single subject has many fragments, flag as variable.
    regularity: aggs.some((a) => a.countCredits > months * 2) ? "variable" : (income.regularity ?? "steady"),
  };
}

// --- Spending --------------------------------------------------------------
//
// monthlyAverage = sum across spending.* aggregates' totalDebits / months
// byCategory: replace LLM-emitted entries that match a ruled subject with
//   deterministic ones; keep LLM's other categories untouched (user hasn't
//   ruled those, LLM's reading stands).

function applySpendingOverride(
  spending: NonNullable<AnalysisShape["spending"]>,
  aggs: SubjectAggregate[],
  months: number,
): AnalysisShape["spending"] {
  const ruledMonthly = aggs.reduce((sum, a) => sum + a.totalDebits / months, 0);
  const otherMonthly = (spending.byCategory ?? []).reduce((sum, c) => sum + c.monthlyAverage, 0);
  const totalMonthly = round(ruledMonthly + otherMonthly);

  const ruledCategories: SpendingCategory[] = aggs.map((a) => {
    const monthly = round(a.totalDebits / months);
    return {
      category: deriveSourceDescription(a),
      monthlyAverage: monthly,
      percentOfSpend: totalMonthly > 0 ? monthly / totalMonthly : 0,
      examples: a.samples.slice(0, 5).map((t) => t.description),
    };
  });

  // Recompute percentOfSpend on LLM categories against the new total
  const llmCategories = (spending.byCategory ?? []).map((c) => ({
    ...c,
    percentOfSpend: totalMonthly > 0 ? c.monthlyAverage / totalMonthly : c.percentOfSpend,
  }));

  return {
    ...spending,
    monthlyAverage: totalMonthly,
    byCategory: [...ruledCategories, ...llmCategories].sort((a, b) => b.monthlyAverage - a.monthlyAverage),
  };
}

// --- Savings ---------------------------------------------------------------
//
// monthlyAverageSaved = net flow across savings.* aggregates / months
// (positive = saving, negative = pulling from savings)

function applySavingsOverride(
  savings: NonNullable<AnalysisShape["savings"]>,
  aggs: SubjectAggregate[],
  months: number,
): AnalysisShape["savings"] {
  const netMonthly = aggs.reduce((sum, a) => sum + a.netFlow / months, 0);
  return {
    ...savings,
    monthlyAverageSaved: round(netMonthly),
  };
}

// --- Helpers ---------------------------------------------------------------

function monthsCovered(transactions: Tx[]): number {
  if (transactions.length === 0) return 0;
  const dates = transactions.map((t) => t.date).sort();
  const first = new Date(dates[0]);
  const last = new Date(dates[dates.length - 1]);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 0;
  // Months between, inclusive of both ends. Minimum 1 to avoid div-by-zero.
  const months =
    (last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth()) + 1;
  return Math.max(months, 1);
}

function deriveSourceDescription(a: SubjectAggregate): string {
  // Prefer the first rationale (user's words). Fall back to subject path.
  const rationale = a.rationales[0];
  if (rationale && rationale.length > 0) {
    // Pull a noun-phrase-y prefix if rationale looks like a sentence.
    return rationale.length <= 80 ? rationale : rationale.slice(0, 77) + "…";
  }
  return a.subject;
}

function deriveFrequency(countCredits: number, months: number): string {
  if (months === 0) return "irregular";
  const perMonth = countCredits / months;
  if (perMonth > 2) return "fragmented (multiple deposits per month)";
  if (perMonth > 0.8 && perMonth < 1.2) return "monthly";
  return "irregular";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
