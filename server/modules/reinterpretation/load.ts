import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { reinterpretations } from "@shared/schema";
import { parseRule, type Rule } from "./schema";

// Load all active reinterpretation rules for a user, validate each into the
// typed union shape, and return them in creation order. Skips (with a warn)
// any row whose predicate jsonb fails its kind-specific schema, so a single
// malformed rule doesn't take down the whole pipeline.

export async function loadActiveRules(userId: string): Promise<Rule[]> {
  const rows = await db
    .select()
    .from(reinterpretations)
    .where(and(eq(reinterpretations.userId, userId), eq(reinterpretations.status, "active")))
    .orderBy(reinterpretations.createdAt);

  const out: Rule[] = [];
  for (const row of rows) {
    try {
      out.push(
        parseRule({
          id: row.id,
          subject: row.subject,
          effect: row.effect,
          rationale: row.rationale,
          predicateKind: row.predicateKind,
          predicate: row.predicate,
        }),
      );
    } catch (err) {
      console.warn(
        `[reinterpretation] skip rule ${row.id} (${row.predicateKind}/${row.subject}): malformed predicate`,
        err,
      );
    }
  }
  return out;
}
