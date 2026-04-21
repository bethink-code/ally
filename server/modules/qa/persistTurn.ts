import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  conversations,
  conversationMessages,
  type Conversation,
  type ConversationMessage,
  type SystemPrompt,
} from "@shared/schema";
import { runQaTurn, type StatementSummary, type QaPhase } from "./chat";
import { mergeFlaggedIssues, mergeProfile } from "./mergeProfile";
import type { QaProfile } from "./schema";

type RunAndPersistInput = {
  conversationId: number;
  userId: string;
  prompt: SystemPrompt;
  user: { firstName: string | null; email: string };
  phase: QaPhase;
  analysis: unknown | null;
  statements: StatementSummary[];
  profile: QaProfile;
  flaggedIssues: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  historyTruncated: boolean;
  // null = opening turn, no user input yet
  latestUser: string | null;
  // Set true when this turn is Ally orienting the user into a new step
  // (conversation start, phase transition). Rendered distinctly in the UI.
  isTransition?: boolean;
};

type RunAndPersistOutput = {
  conversation: Conversation;
  assistantMessage: ConversationMessage;
};

// One turn: call Claude, persist assistant message, merge profile + flags, update conversation row.
// Throws if the Claude call fails — caller handles user-facing error + audit.
export async function runAndPersistTurn(input: RunAndPersistInput): Promise<RunAndPersistOutput> {
  const { result, usage } = await runQaTurn({
    systemPrompt: input.prompt.content,
    model: input.prompt.model,
    user: input.user,
    phase: input.phase,
    analysis: input.analysis,
    statements: input.statements,
    profile: input.profile,
    flaggedIssues: input.flaggedIssues,
    history: input.history,
    historyTruncated: input.historyTruncated,
    latestUser: input.latestUser,
  });

  const [assistantMessage] = await db
    .insert(conversationMessages)
    .values({
      conversationId: input.conversationId,
      role: "assistant",
      content: result.reply,
      profileUpdates: result.profileUpdates as unknown as object,
      status: result.status,
      isTransition: input.isTransition ?? false,
      promptVersionId: input.prompt.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
    })
    .returning();

  const mergedProfile = mergeProfile(input.profile, result.profileUpdates);
  const mergedFlags = mergeFlaggedIssues(input.flaggedIssues, result.newFlaggedIssues);
  const newStatus = result.status === "complete" ? "complete" : "active";

  const [conversation] = await db
    .update(conversations)
    .set({
      profile: mergedProfile as unknown as object,
      flaggedIssues: mergedFlags as unknown as object,
      status: newStatus,
      updatedAt: new Date(),
      completedAt: newStatus === "complete" ? new Date() : null,
    })
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
    .returning();

  return { conversation, assistantMessage };
}
