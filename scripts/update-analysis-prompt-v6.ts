// v6 of analysis prompt — tighten annotation guidance so the LLM emits
// phrases that match the prose verbatim (or at least case-insensitively).
// Audit found one phrase ("nine invoices totalling R381,447") that didn't
// appear in the prose at all — silently no-clickable. The matcher is now
// case-insensitive (client-side fix) but still requires the phrase to
// substring-match. This prompt update reinforces the verbatim rule.
//
// Run: doppler run -- npx tsx scripts/update-analysis-prompt-v6.ts

import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { systemPrompts } from "../shared/schema";

const newAnnotationSection = `## Annotations — clickable phrases in the prose

For each prose paragraph (lifeSnapshot, income.summary, spending.summary, savings.summary), pick **0 to 3** phrases that would benefit from a one-click "explain me this" expansion. Emit them in the matching \`*Annotations\` array.

Each annotation has:
- \`kind\`: always "explain"
- \`phrase\`: a phrase that **appears verbatim in the prose paragraph above**. Critical rule: the matcher does a substring search, so the phrase must be a contiguous slice of the prose text. Case is not strict (matching is case-insensitive) but spelling, punctuation, numbers, and word boundaries must be exact. **Pick the phrase by COPY-PASTING it from the prose you just wrote.** Do not paraphrase.
- \`anchorId\`: a short stable id like "income-pattern", "monthly-rhythm", "savings-shape"

For every annotation, emit a matching \`explainClaim\` (top-level array) with the same \`anchorId\`. The claim's \`body\` is what the user sees when they click — 1-3 sentences that go deeper than the headline. Plain language, evidence-grounded.

**Bad (do NOT do this):**
- Prose says: "Nine invoices totalling roughly R381,000 came in across the period."
- Annotation phrase: "nine invoices totalling R381,447"  ← WRONG: paraphrased the number.

**Good:**
- Prose says: "Nine invoices totalling roughly R381,000 came in across the period."
- Annotation phrase: "Nine invoices totalling roughly R381,000"  ← copy-pasted from the prose verbatim.

**What to make clickable:**
- Phrases that name a pattern (e.g. "drip-feeds from your business", "two-week spending cycle")
- Phrases that carry a number or rhythm worth backing up
- Phrases that might surprise or land hard for the user — give them a one-click way to see the working

**What NOT to make clickable:**
- Filler words or generic phrases ("your money", "every month")
- Things already obvious from the surrounding sentence
- Phrases that don't appear in the prose verbatim — drop them rather than approximate

**Annotation/claim coherence:** every annotation MUST have a matching explainClaim with the same anchorId. If you can't write a claim body for a phrase, drop the annotation. Better to have 3 working highlights than 5 with broken clicks. The post-processor will drop orphans either way — pre-emptively writing a coherent set wastes fewer tokens.

If a paragraph has nothing worth making clickable, return an empty array. Better to skip than annotate weakly.`;

async function main() {
  const [row] = await db
    .select()
    .from(systemPrompts)
    .where(and(eq(systemPrompts.promptKey, "analysis"), eq(systemPrompts.isActive, true)))
    .limit(1);
  if (!row) {
    console.error("no active analysis prompt");
    process.exit(1);
  }

  // Replace the existing annotations section.
  const oldSectionMarker = "## Annotations — clickable phrases in the prose";
  const nextSectionMarker = "## How to write";
  const start = row.content.indexOf(oldSectionMarker);
  const end = row.content.indexOf(nextSectionMarker);
  if (start < 0 || end < 0 || end <= start) {
    console.error("could not locate annotation section bounds");
    process.exit(1);
  }
  const before = row.content.slice(0, start);
  const after = row.content.slice(end);
  const newContent = before + newAnnotationSection + "\n\n" + after;

  await db
    .update(systemPrompts)
    .set({ content: newContent })
    .where(eq(systemPrompts.id, row.id));
  console.log(`updated analysis: ${row.content.length} → ${newContent.length} chars`);

  const checks = [
    "COPY-PASTING it from the prose",
    "Nine invoices totalling roughly R381,000",
    "Annotation/claim coherence",
    "case-insensitive",
  ];
  const updated = (await db.select().from(systemPrompts).where(eq(systemPrompts.id, row.id)))[0];
  for (const c of checks) {
    if (!updated.content.includes(c)) {
      console.error(`MISSING: ${c}`);
      process.exit(1);
    }
  }
  console.log("all checks present ✓");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
