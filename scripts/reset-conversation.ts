// Dev helper — wipes a user's QA conversation + messages so the next drawer-open
// triggers a fresh opener. Usage:
//   doppler run -- npx tsx scripts/reset-conversation.ts --email garth@bethink.co.za

import { db } from "../server/db";
import { conversations, conversationMessages, users } from "../shared/schema";
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

const rows = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, user.id));
if (rows.length === 0) {
  console.log(`[reset-conversation] ${email} — no conversation to reset.`);
  process.exit(0);
}

const ids = rows.map((r) => r.id);
const deletedMessages = await db.delete(conversationMessages).where(inArray(conversationMessages.conversationId, ids)).returning({ id: conversationMessages.id });
await db.delete(conversations).where(eq(conversations.userId, user.id));

console.log(`[reset-conversation] ${email} — deleted ${rows.length} conversation(s) and ${deletedMessages.length} message(s).`);
process.exit(0);
