// Dev helper — wipes a user's entire product state so they can walk through the full
// Ally experience from the top (onboarding → bring it in → first take & gaps → chat).
// Preserves the user row (so their OAuth identity and isAdmin flag survive) and the
// active session, but clears every piece of user-generated content and onboarding flags.
// Usage:
//   doppler run -- npx tsx scripts/reset-profile.ts --email garth@bethink.co.za

import { db } from "../server/db";
import {
  conversations,
  conversationMessages,
  analyses,
  statements,
  users,
} from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

const emailArg = process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length);
const email = emailArg ?? process.argv[process.argv.indexOf("--email") + 1];

if (!email || email.startsWith("--")) {
  console.error("Usage: --email <user-email>");
  process.exit(1);
}

const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
if (!user) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}

let convCount = 0;
let msgCount = 0;
let analysesCount = 0;
let statementsCount = 0;

// Conversations + messages
const convRows = await db
  .select({ id: conversations.id })
  .from(conversations)
  .where(eq(conversations.userId, user.id));
const convIds = convRows.map((r) => r.id);
if (convIds.length > 0) {
  const deletedMsgs = await db
    .delete(conversationMessages)
    .where(inArray(conversationMessages.conversationId, convIds))
    .returning({ id: conversationMessages.id });
  msgCount = deletedMsgs.length;
  const deletedConvs = await db
    .delete(conversations)
    .where(eq(conversations.userId, user.id))
    .returning({ id: conversations.id });
  convCount = deletedConvs.length;
}

// Analyses
const deletedAnalyses = await db
  .delete(analyses)
  .where(eq(analyses.userId, user.id))
  .returning({ id: analyses.id });
analysesCount = deletedAnalyses.length;

// Statements
const deletedStatements = await db
  .delete(statements)
  .where(eq(statements.userId, user.id))
  .returning({ id: statements.id });
statementsCount = deletedStatements.length;

// Reset user flags and name/contact/photo so they re-enter onboarding as a fresh user.
// isAdmin, id, email, profileImageUrl (from Google), createdAt all preserved.
await db
  .update(users)
  .set({
    firstName: null,
    lastName: null,
    cell: null,
    photoDataUrl: null,
    onboardedAt: null,
    buildCompletedAt: null,
    termsAcceptedAt: null,
    updatedAt: new Date(),
  })
  .where(eq(users.id, user.id));

console.log(`[reset-profile] ${email} — reset complete.`);
console.log(
  `  deleted: ${convCount} conversation(s), ${msgCount} message(s), ${analysesCount} analysis(es), ${statementsCount} statement(s).`,
);
console.log(`  flags cleared: onboardedAt, buildCompletedAt, termsAcceptedAt.`);
console.log(`  preserved: user row, isAdmin, Google OAuth identity, session.`);
console.log(`Reload the app — you'll land in onboarding.`);
process.exit(0);
