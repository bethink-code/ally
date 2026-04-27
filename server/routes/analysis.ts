import { Router } from "express";
import { db } from "../db";
import { analyses, analysisClaims, conversations, statements, subSteps } from "@shared/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { analyseStatements } from "../modules/analysis/analyse";

const router = Router();
router.use(isAuthenticated);

router.get("/api/analysis/latest", async (req, res) => {
  const user = req.user as { id: string };
  // Only return analyses that have actually finished — otherwise an
  // in-progress / failed row with no `result` masks the previous good one
  // and downstream UI gets stuck on "Loading your picture…".
  const [row] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, user.id), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);
  res.json(row ?? null);
});

// GET /api/analysis/:id/claims — explain claims for a Canvas 1 first-take
// analysis. Same shape as /api/analysis-draft/:id/claims (Canvas 2). Lets
// StoryArticle render clickable phrases and ExplainPane resolve them.
router.get("/api/analysis/:id/claims", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  // Ownership check first — never leak existence via the claims endpoint.
  const [row] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, user.id)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });

  const claims = await db
    .select()
    .from(analysisClaims)
    .where(eq(analysisClaims.analysisId, id));
  res.json(claims);
});

router.post("/api/analysis/run", async (req, res) => {
  const user = req.user as { id: string };

  const sts = await db
    .select()
    .from(statements)
    .where(and(eq(statements.userId, user.id), eq(statements.status, "extracted")));

  if (sts.length === 0) {
    return res.status(400).json({ error: "no_statements" });
  }

  const prompt = await getActivePrompt("analysis");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_analysis_prompt" });
  }

  const [created] = await db
    .insert(analyses)
    .values({
      userId: user.id,
      status: "analysing",
      promptVersionId: prompt.id,
      sourceStatementIds: sts.map((s) => s.id) as unknown as object,
    })
    .returning();

  audit({ req, action: "analysis.start", resourceType: "analysis", resourceId: String(created.id) });

  try {
    const { result, usage } = await analyseStatements({
      systemPrompt: prompt.content,
      model: prompt.model,
      statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
    });

    const [finished] = await db
      .update(analyses)
      .set({
        status: "done",
        result: result as unknown as object,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        completedAt: new Date(),
      })
      .where(eq(analyses.id, created.id))
      .returning();

    // Persist explain claims so StoryArticle's clickable phrases resolve.
    // (The /refresh and sub-step worker paths already do this; this route
    // was the orphan caller.)
    await persistAnalysisClaims(created.id, result);

    audit({
      req,
      action: "analysis.success",
      resourceType: "analysis",
      resourceId: String(created.id),
      detail: { usage },
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db
      .update(analyses)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(eq(analyses.id, created.id));
    audit({
      req,
      action: "analysis.failure",
      resourceType: "analysis",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message },
    });
    res.status(500).json({ error: "analysis_failed", message });
  }
});

// POST /api/analysis/refresh — regenerate the Canvas 1 first-take analysis
// using the user's running qa profile + flagged issues as context. Used by:
//   1. Manual "Refresh" button on the picture artefact pane
//   2. Auto-trigger from qa chat when the user gives a substantive correction
//
// Inserts a NEW analyses row + new analysis_claims rows. The previous
// analysis stays for audit. /api/analysis/latest returns the new one.
router.post("/api/analysis/refresh", async (req, res) => {
  const user = req.user as { id: string };

  const sts = await db
    .select()
    .from(statements)
    .where(and(eq(statements.userId, user.id), eq(statements.status, "extracted")));
  if (sts.length === 0) return res.status(400).json({ error: "no_statements" });

  const prompt = await getActivePrompt("analysis");
  if (!prompt) return res.status(500).json({ error: "no_active_analysis_prompt" });

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .limit(1);

  // Insert in-progress row up front so the UI can poll status if needed.
  const [created] = await db
    .insert(analyses)
    .values({
      userId: user.id,
      status: "analysing",
      promptVersionId: prompt.id,
      sourceStatementIds: sts.map((s) => s.id) as unknown as object,
    })
    .returning();

  audit({ req, action: "analysis.refresh_start", resourceType: "analysis", resourceId: String(created.id) });

  // Respond immediately; do the work in the background. Client polls
  // /api/analysis/latest (which returns the most recent done row) to pick up
  // the new analysis when it lands.
  res.json({ analysisId: created.id, status: "analysing" });

  void (async () => {
    try {
      const { result, usage } = await analyseStatements({
        systemPrompt: prompt.content,
        model: prompt.model,
        statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
        conversationProfile: conv?.profile ?? null,
        flaggedIssues: conv?.flaggedIssues ?? [],
      });
      await db
        .update(analyses)
        .set({
          status: "done",
          result: result as unknown as object,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          completedAt: new Date(),
        })
        .where(eq(analyses.id, created.id));

      await persistAnalysisClaims(created.id, result);

      // Repoint the user's current Discuss/Live picture sub-step at the new
      // analysis so any consumer reading contentJson.analysisId sees the
      // refreshed version.
      await db
        .update(subSteps)
        .set({
          contentJson: { analysisId: created.id } as unknown as object,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subSteps.userId, user.id),
            eq(subSteps.canvasKey, "picture"),
            isNull(subSteps.supersededAt),
          ),
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      console.error("[analysis.refresh] failed:", err);
      await db
        .update(analyses)
        .set({ status: "failed", errorMessage: message, completedAt: new Date() })
        .where(eq(analyses.id, created.id));
    }
  })();
});

// Persist Canvas 1 explain claims for an analyses row. Used by /run +
// /refresh; the sub-step worker has its own (functionally-equivalent) copy.
// All three feed the same analysis_claims table with analysis_id set.
async function persistAnalysisClaims(analysisId: number, result: unknown): Promise<void> {
  type Claim = {
    anchorId: string;
    label: string;
    body: string;
    evidenceRefs: Array<{ kind: string; ref: string }>;
    chartKind: string;
  };
  type Annotation = { kind: string; phrase: string; anchorId: string };
  const r = result as {
    explainClaims?: Claim[];
    lifeSnapshotAnnotations?: Annotation[];
    income?: { summaryAnnotations?: Annotation[] };
    spending?: { summaryAnnotations?: Annotation[] };
    savings?: { summaryAnnotations?: Annotation[] };
  };
  const claims = r.explainClaims ?? [];
  if (claims.length === 0) return;

  const phraseByAnchor = new Map<string, string>();
  for (const a of r.lifeSnapshotAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.income?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.spending?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.savings?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);

  await db.insert(analysisClaims).values(
    claims.map((c) => ({
      analysisId,
      kind: "explain" as const,
      anchorId: c.anchorId,
      label: phraseByAnchor.get(c.anchorId) ?? c.label,
      body: c.body,
      evidenceRefs: { refs: c.evidenceRefs, chartKind: c.chartKind } as unknown as object,
    })),
  );
}

export default router;
