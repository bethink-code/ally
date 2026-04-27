import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { analysisSchema, type AnalysisResult } from "./schema";

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
  const body = buildUserMessage(input.statements, input.conversationProfile, input.flaggedIssues);

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

  return {
    result: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

function buildUserMessage(
  statements: AnalyseInput["statements"],
  profile?: unknown,
  flaggedIssues?: unknown,
): string {
  const header = `You are being given ${statements.length} extracted bank statements covering a period of months. Analyse the whole set together, not one at a time.\n\n`;
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
  if (!hasProfile && flagsArr.length === 0) return header + body;

  const tail: string[] = ["", "## What the user has told us so far (incorporate this)"];
  if (hasProfile) {
    tail.push("```json", JSON.stringify(profileObj), "```");
  }
  if (flagsArr.length > 0) {
    tail.push("", "Flagged issues:", ...flagsArr.map((f) => `- ${f}`));
  }
  tail.push(
    "",
    "Treat these as authoritative corrections / context. They override any default reading of the raw transactions.",
  );
  return header + body + "\n\n" + tail.join("\n");
}
