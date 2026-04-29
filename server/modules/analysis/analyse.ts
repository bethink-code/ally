import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { analysisSchema, type AnalysisResult } from "./schema";
import {
  formatAggregatesForPrompt,
  type SubjectAggregate,
  type Tx,
} from "../reinterpretation/apply";
import { overrideAnalysisResult } from "../reinterpretation/override";

const client = new Anthropic();

type AnalyseInput = {
  systemPrompt: string;
  model: string;
  statements: Array<{
    filename: string;
    extraction: unknown;
  }>;
  // Optional running profile + flagged issues from the qa conversation.
  // Passed through on regeneration so the new analysis incorporates
  // corrections the user made in chat (e.g. "that's not salary, that's
  // self-funding from my business").
  conversationProfile?: unknown;
  flaggedIssues?: unknown;
  // Deterministic per-subject aggregates computed from raw transactions
  // by applying the user's active reinterpretation rules. When present,
  // these numbers ARE the source of truth for the listed subjects — the
  // LLM narrates around them, doesn't recompute.
  subjectAggregates?: Record<string, SubjectAggregate>;
  // The flat transaction list used to compute the aggregates above. Passed
  // through so the post-LLM override pass can derive months-covered etc.
  // and overwrite structured fields with deterministic numbers.
  rawTransactions?: Tx[];
};

type AnalyseOutput = {
  result: AnalysisResult;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

export async function analyseStatements(input: AnalyseInput): Promise<AnalyseOutput> {
  const body = buildUserMessage(
    input.statements,
    input.conversationProfile,
    input.flaggedIssues,
    input.subjectAggregates,
  );

  const response = await client.messages.parse({
    model: input.model,
    // Lowered from 16000 — observed outputs are ~3.5k tokens. The high
    // ceiling was costing latency without ever being needed.
    max_tokens: 6000,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: body,
      },
    ],
    output_config: { format: zodOutputFormat(analysisSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Analysis returned no parsed output");
  }

  // Drop orphan annotations / unreferenced claims before handing back, so
  // every clickable phrase in the rendered prose has a body to display.
  let result = sanitizeAnalysisResult(response.parsed_output) as AnalysisResult;

  // Deterministic post-LLM override: when reinterpretation rules cover a
  // category (income / spending / savings), overwrite the structured numeric
  // fields with values computed from the aggregates. The LLM's prose stays;
  // its monthlyAverage / sources / etc. don't get to fudge the truth.
  if (input.subjectAggregates && input.rawTransactions) {
    result = overrideAnalysisResult(
      result,
      input.subjectAggregates,
      input.rawTransactions,
    ) as AnalysisResult;
  }

  return {
    result,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

// Drop any annotation whose anchorId doesn't have a matching explainClaim,
// and drop any explainClaim whose anchorId isn't referenced by an
// annotation. The LLM occasionally emits one without the other; without
// this sanitiser the user clicks a highlighted phrase and lands on
// "Couldn't find the evidence for that one." Idempotent — safe to call on
// already-sanitised results.
export function sanitizeAnalysisResult(result: unknown): unknown {
  type Annotation = { kind: string; phrase: string; anchorId: string };
  type Claim = { anchorId: string; [k: string]: unknown };
  const r = result as {
    lifeSnapshotAnnotations?: Annotation[];
    income?: { summaryAnnotations?: Annotation[] } & Record<string, unknown>;
    spending?: { summaryAnnotations?: Annotation[] } & Record<string, unknown>;
    savings?: { summaryAnnotations?: Annotation[] } & Record<string, unknown>;
    explainClaims?: Claim[];
  } & Record<string, unknown>;
  if (!r || typeof r !== "object") return result;

  const claims = r.explainClaims ?? [];
  const claimAnchors = new Set(claims.map((c) => c.anchorId));
  const annotationAnchors = new Set<string>();

  const filterAnns = (anns?: Annotation[]) =>
    (anns ?? []).filter((a) => {
      if (claimAnchors.has(a.anchorId)) {
        annotationAnchors.add(a.anchorId);
        return true;
      }
      return false;
    });

  const sanitised = {
    ...r,
    lifeSnapshotAnnotations: filterAnns(r.lifeSnapshotAnnotations),
    income: r.income ? { ...r.income, summaryAnnotations: filterAnns(r.income.summaryAnnotations) } : r.income,
    spending: r.spending ? { ...r.spending, summaryAnnotations: filterAnns(r.spending.summaryAnnotations) } : r.spending,
    savings: r.savings ? { ...r.savings, summaryAnnotations: filterAnns(r.savings.summaryAnnotations) } : r.savings,
    // Drop claims that no annotation references — they'd be unreachable.
    explainClaims: claims.filter((c) => annotationAnchors.has(c.anchorId)),
  };
  return sanitised;
}

function buildUserMessage(
  statements: AnalyseInput["statements"],
  profile?: unknown,
  flaggedIssues?: unknown,
  subjectAggregates?: Record<string, SubjectAggregate>,
): string {
  const header = `You are being given ${statements.length} extracted bank statements covering a period of months. Analyse the whole set together, not one at a time.\n\n`;

  // Authoritative aggregates section. Comes BEFORE the raw statements so the
  // LLM has the source-of-truth numbers in mind before it starts categorising.
  // When the user has stated reinterpretation rules ("all Herbal Horse credits
  // are my salary"), the apply pipeline has computed deterministic per-subject
  // totals from the raw data — those totals override any reading the LLM
  // would otherwise make.
  const aggregatesSection =
    subjectAggregates && Object.keys(subjectAggregates).length > 0
      ? formatAggregatesForPrompt(subjectAggregates) + "\n\n"
      : "";

  // Compact JSON (no pretty-print). Saves ~30% tokens — each statement's
  // transactions array is the bulk of the input.
  const body = statements
    .map((s, i) => `## Statement ${i + 1} — ${s.filename}\n\`\`\`json\n${JSON.stringify(s.extraction)}\n\`\`\``)
    .join("\n\n");

  // Optional context from the running qa conversation. Surfaces on
  // regeneration so corrections the user made in chat take effect in the
  // new analysis (e.g. "that R20k transfer is not salary, it's self-funding
  // from my business" → next analysis treats it as income).
  const profileObj = (profile ?? {}) as Record<string, unknown>;
  const hasProfile = profileObj && Object.keys(profileObj).some((k) => {
    const v = profileObj[k];
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return v != null;
  });
  const flagsArr = Array.isArray(flaggedIssues) ? (flaggedIssues as string[]) : [];
  if (!hasProfile && flagsArr.length === 0) return aggregatesSection + header + body;

  const tail: string[] = ["", "## What the user has told us so far (incorporate this)"];
  if (hasProfile) {
    tail.push("```json", JSON.stringify(profileObj), "```");
  }
  if (flagsArr.length > 0) {
    tail.push("", "Flagged issues:", ...flagsArr.map((f) => `- ${f}`));
  }
  tail.push(
    "",
    "Treat these as authoritative corrections / context. They override any default reading of the raw transactions. " +
      "If a reinterpretation aggregate above also covers this subject, use the aggregate's number — never re-derive it.",
  );
  return aggregatesSection + header + body + "\n\n" + tail.join("\n");
}
