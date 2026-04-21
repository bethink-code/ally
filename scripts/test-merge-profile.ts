// Assertion script for mergeProfile semantics (flat string-based profile).
// Run with: npx tsx scripts/test-merge-profile.ts

import { emptyProfile, type QaProfile } from "../server/modules/qa/schema";
import { mergeProfile, mergeFlaggedIssues } from "../server/modules/qa/mergeProfile";

let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    console.error(`  FAIL  ${name}`);
    failed += 1;
  }
}
function eq<T>(name: string, a: T, b: T) {
  check(name, JSON.stringify(a) === JSON.stringify(b));
}

// 1. Empty profile has empty arrays and empty strings.
{
  const p = emptyProfile();
  eq("empty.corrections", p.corrections, []);
  eq("empty.goals", p.goals, []);
  check("empty.retirement blank", p.retirement === "");
  check("empty.medicalCover blank", p.medicalCover === "");
}

// 2. Merging undefined is a no-op.
{
  const p = emptyProfile();
  eq("noop undefined", mergeProfile(p, undefined), p);
}

// 3. Non-empty string overwrites empty.
{
  const p = emptyProfile();
  const out = mergeProfile(p, { ...p, retirement: "Has employer fund, contributes 10%." });
  check("overwrite empty with value", out.retirement === "Has employer fund, contributes 10%.");
}

// 4. Empty string in update does NOT clobber existing non-empty value.
{
  const base: QaProfile = { ...emptyProfile(), retirement: "Has employer fund." };
  const out = mergeProfile(base, { ...emptyProfile(), retirement: "" });
  check("empty string doesn't clobber", out.retirement === "Has employer fund.");
}

// 5. Whitespace-only update does NOT clobber.
{
  const base: QaProfile = { ...emptyProfile(), tax: "PAYE only." };
  const out = mergeProfile(base, { ...emptyProfile(), tax: "   " });
  check("whitespace doesn't clobber", out.tax === "PAYE only.");
}

// 6. New non-empty string overwrites existing non-empty string (agent's latest view wins).
{
  const base: QaProfile = { ...emptyProfile(), lifeCover: "Old note." };
  const out = mergeProfile(base, { ...emptyProfile(), lifeCover: "Has R1M life cover through employer." });
  check("non-empty overwrites", out.lifeCover === "Has R1M life cover through employer.");
}

// 7. Corrections dedup + append.
{
  const base: QaProfile = { ...emptyProfile(), corrections: ["income is wrong"] };
  const out = mergeProfile(base, { ...emptyProfile(), corrections: ["income is wrong", "account is not mine"] });
  eq("corrections append dedup", out.corrections, ["income is wrong", "account is not mine"]);
}

// 8. Goals append preserving exact user text, dedup on exact match.
{
  const base: QaProfile = { ...emptyProfile(), goals: ["Buy a house one day"] };
  const out = mergeProfile(base, {
    ...emptyProfile(),
    goals: ["Buy a house one day", "Take my kids to Thailand"],
  });
  eq("goals dedup + append", out.goals, ["Buy a house one day", "Take my kids to Thailand"]);
}

// 9. Goals — agent's own words preserved, NOT reformatted.
{
  const base: QaProfile = { ...emptyProfile(), goals: [] };
  const out = mergeProfile(base, {
    ...emptyProfile(),
    goals: ["i just wanna stop stressing about money"],
  });
  check("verbatim goal preserved", out.goals[0] === "i just wanna stop stressing about money");
}

// 10. Flagged issues append + dedup.
{
  const before = ["All income from one client."];
  const out = mergeFlaggedIssues(before, ["All income from one client.", "No cover for dependents."]);
  eq("flagged dedup", out, ["All income from one client.", "No cover for dependents."]);
}

// 11. Flagged issues with empty/null input is a no-op.
{
  const before = ["x"];
  eq("flagged empty input", mergeFlaggedIssues(before, []), before);
  eq("flagged null input", mergeFlaggedIssues(before, null), before);
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll assertions passed.");
process.exit(0);
