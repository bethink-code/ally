import type { QaProfile, QaProfileUpdate } from "./schema";

// Merge this turn's updates into the running profile.
// Strings: non-empty update overwrites; empty/whitespace = no change (keep existing).
// Arrays (corrections, goals): append new items, dedup on exact text match.
export function mergeProfile(existing: QaProfile, updates: QaProfileUpdate | null | undefined): QaProfile {
  if (!updates) return existing;
  return {
    corrections: concatDedup(existing.corrections, updates.corrections),
    otherAccounts: preferUpdate(existing.otherAccounts, updates.otherAccounts),
    incomeContext: preferUpdate(existing.incomeContext, updates.incomeContext),
    debt: preferUpdate(existing.debt, updates.debt),
    medicalCover: preferUpdate(existing.medicalCover, updates.medicalCover),
    lifeCover: preferUpdate(existing.lifeCover, updates.lifeCover),
    incomeProtection: preferUpdate(existing.incomeProtection, updates.incomeProtection),
    retirement: preferUpdate(existing.retirement, updates.retirement),
    tax: preferUpdate(existing.tax, updates.tax),
    property: preferUpdate(existing.property, updates.property),
    goals: concatDedup(existing.goals, updates.goals),
    lifeContext: preferUpdate(existing.lifeContext, updates.lifeContext),
    will: preferUpdate(existing.will, updates.will),
  };
}

export function mergeFlaggedIssues(existing: string[], incoming: string[] | null | undefined): string[] {
  if (!incoming || incoming.length === 0) return existing;
  return concatDedup(existing, incoming);
}

function preferUpdate(existing: string, update: string | null | undefined): string {
  if (typeof update !== "string") return existing;
  return update.trim().length > 0 ? update : existing;
}

function concatDedup(existing: string[], incoming: string[] | null | undefined): string[] {
  if (!incoming || incoming.length === 0) return existing;
  const seen = new Set(existing);
  const out = [...existing];
  for (const s of incoming) {
    if (!seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  return out;
}
