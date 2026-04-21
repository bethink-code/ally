var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/api.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

// server/auth.ts
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

// server/db.ts
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  accessRequests: () => accessRequests,
  analyses: () => analyses,
  auditLogs: () => auditLogs,
  conversationMessages: () => conversationMessages,
  conversations: () => conversations,
  insertAccessRequestSchema: () => insertAccessRequestSchema,
  insertInviteSchema: () => insertInviteSchema,
  invitedUsers: () => invitedUsers,
  onboardSchema: () => onboardSchema,
  savePromptSchema: () => savePromptSchema,
  sessions: () => sessions,
  statements: () => statements,
  systemPrompts: () => systemPrompts,
  users: () => users
});
import { pgTable, text, timestamp, boolean, integer, serial, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { mode: "date" }).notNull()
  },
  (t) => [index("idx_sessions_expire").on(t.expire)]
);
var users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  // from Google OAuth
  photoDataUrl: text("photo_data_url"),
  // user-uploaded photo, overrides Google avatar
  cell: text("cell"),
  onboardedAt: timestamp("onboarded_at"),
  buildCompletedAt: timestamp("build_completed_at"),
  isAdmin: boolean("is_admin").notNull().default(false),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});
var invitedUsers = pgTable("invited_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  invitedBy: text("invited_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var accessRequests = pgTable("access_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  cell: text("cell"),
  status: text("status").notNull().default("pending"),
  // pending | approved | declined
  createdAt: timestamp("created_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by").references(() => users.id)
});
var auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  outcome: text("outcome").notNull().default("success"),
  detail: jsonb("detail"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var systemPrompts = pgTable("system_prompts", {
  id: serial("id").primaryKey(),
  promptKey: text("prompt_key").notNull(),
  // extraction | analysis | qa | story
  label: text("label").notNull(),
  description: text("description"),
  model: text("model").notNull().default("claude-sonnet-4-6"),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var statements = pgTable("statements", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes"),
  contentHash: text("content_hash"),
  // SHA-256 of PDF bytes — dedupe key per user
  status: text("status").notNull().default("extracting"),
  // extracting | extracted | failed
  extractionResult: jsonb("extraction_result"),
  extractionError: text("extraction_error"),
  promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at")
});
var analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("analysing"),
  // analysing | done | failed
  result: jsonb("result"),
  errorMessage: text("error_message"),
  promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
  sourceStatementIds: jsonb("source_statement_ids"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at")
});
var conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  status: text("status").notNull().default("active"),
  // active | paused | complete
  profile: jsonb("profile"),
  // accumulated QaProfile — what the agent has confirmed so far
  flaggedIssues: jsonb("flagged_issues"),
  // array of plain-language flags the agent has surfaced
  analysisIdAtStart: integer("analysis_id_at_start").references(() => analyses.id),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at")
});
var conversationMessages = pgTable(
  "conversation_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversations.id),
    role: text("role").notNull(),
    // user | assistant
    content: text("content").notNull(),
    profileUpdates: jsonb("profile_updates"),
    // what the assistant extracted on this turn (null for user messages)
    status: text("status"),
    // what the assistant set conversation status to on this turn
    // Assistant messages generated at a phase boundary (conversation start, phase transition).
    // The client renders these with a distinct visual treatment so the user sees them as
    // Ally orienting them to a new step rather than a regular reply.
    isTransition: boolean("is_transition").notNull().default(false),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("idx_conversation_messages_conversation_id").on(t.conversationId)]
);
var insertAccessRequestSchema = createInsertSchema(accessRequests).pick({
  name: true,
  email: true,
  cell: true
});
var insertInviteSchema = z.object({
  email: z.string().email()
});
var savePromptSchema = z.object({
  promptKey: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  model: z.string().min(1),
  content: z.string().min(1)
});
var onboardSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  cell: z.string().max(30).optional(),
  photoDataUrl: z.string().startsWith("data:image/").max(5e5).optional()
});

// server/db.ts
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set \u2014 is Doppler running?");
}
var connectionString = process.env.DATABASE_URL.replace(/[?&]channel_binding=require/, "");
var pool = new Pool({ connectionString });
var db = drizzle(pool, { schema: schema_exports });

// server/auth.ts
import { eq } from "drizzle-orm";

// server/auditLog.ts
function audit(input) {
  const userId = input.userId ?? input.req?.user?.id ?? null;
  const ipAddress = input.req?.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? input.req?.socket.remoteAddress ?? null;
  db.insert(auditLogs).values({
    userId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? "success",
    detail: input.detail,
    ipAddress
  }).catch((err) => {
    console.error("[audit] failed to write log:", err);
  });
}

// server/auth.ts
var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1e3;
function setupAuth(app2) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET not set");
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not set");
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET not set");
  const PgStore = connectPgSimple(session);
  const isProd = process.env.NODE_ENV === "production";
  app2.use(
    session({
      store: new PgStore({ pool, tableName: "sessions", createTableIfMissing: false }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: SEVEN_DAYS_MS
      }
    })
  );
  app2.use(passport.initialize());
  app2.use(passport.session());
  const callbackURL = isProd ? `${process.env.PUBLIC_URL ?? ""}/auth/callback` : "http://localhost:5000/auth/callback";
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL
      },
      async (_at, _rt, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) return done(null, false);
          const [invite] = await db.select().from(invitedUsers).where(eq(invitedUsers.email, email));
          const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
          const isSeedAdmin = email === adminEmail;
          if (!invite && !isSeedAdmin) {
            return done(null, false, { message: "not_invited" });
          }
          const [existing] = await db.select().from(users).where(eq(users.email, email));
          if (existing) {
            const [updated] = await db.update(users).set({
              firstName: profile.name?.givenName ?? existing.firstName,
              lastName: profile.name?.familyName ?? existing.lastName,
              profileImageUrl: profile.photos?.[0]?.value ?? existing.profileImageUrl,
              updatedAt: /* @__PURE__ */ new Date()
            }).where(eq(users.id, existing.id)).returning();
            return done(null, updated);
          }
          const [created] = await db.insert(users).values({
            id: profile.id,
            email,
            firstName: profile.name?.givenName,
            lastName: profile.name?.familyName,
            profileImageUrl: profile.photos?.[0]?.value,
            isAdmin: isSeedAdmin
          }).returning();
          return done(null, created);
        } catch (err) {
          done(err);
        }
      }
    )
  );
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });
}
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ error: "unauthorized" });
}
function isAdmin(req, res, next) {
  const user = req.user;
  if (req.isAuthenticated?.() && user?.isAdmin) return next();
  audit({ req, action: "admin.access_denied", outcome: "failure" });
  res.status(403).json({ error: "forbidden" });
}

// server/routes/auth.ts
import { Router } from "express";
import passport2 from "passport";
import { eq as eq2 } from "drizzle-orm";
var router = Router();
var CLIENT_URL = process.env.NODE_ENV === "production" ? process.env.PUBLIC_URL ?? "/" : "http://localhost:5173";
router.get("/auth/google", passport2.authenticate("google", { scope: ["profile", "email"] }));
router.get(
  "/auth/callback",
  passport2.authenticate("google", {
    failureRedirect: `${CLIENT_URL}/?error=not_invited`
  }),
  (req, res) => {
    audit({ req, action: "auth.login" });
    res.redirect(CLIENT_URL);
  }
);
router.post("/auth/logout", (req, res) => {
  audit({ req, action: "auth.logout" });
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});
router.get("/api/auth/user", (req, res) => {
  if (!req.isAuthenticated?.()) return res.json(null);
  res.json(req.user);
});
router.post("/api/user/accept-terms", isAuthenticated, async (req, res) => {
  const user = req.user;
  await db.update(users).set({ termsAcceptedAt: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id));
  audit({ req, action: "user.accept_terms" });
  res.json({ ok: true });
});
router.post("/api/user/build-complete", isAuthenticated, async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(users).set({ buildCompletedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id)).returning();
  audit({ req, action: "user.build_complete" });
  res.json(updated);
});
router.post("/api/user/build-reopen", isAuthenticated, async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(users).set({ buildCompletedAt: null, updatedAt: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id)).returning();
  audit({ req, action: "user.build_reopen" });
  res.json(updated);
});
router.post("/api/user/onboard", isAuthenticated, async (req, res) => {
  const parsed = onboardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const user = req.user;
  const [updated] = await db.update(users).set({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    cell: parsed.data.cell,
    photoDataUrl: parsed.data.photoDataUrl,
    onboardedAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq2(users.id, user.id)).returning();
  audit({ req, action: "user.onboard_complete" });
  res.json(updated);
});
router.post("/api/request-access", async (req, res) => {
  const parsed = insertAccessRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const [created] = await db.insert(accessRequests).values(parsed.data).returning();
  audit({ action: "access_request.create", resourceType: "access_request", resourceId: String(created.id) });
  res.json({ ok: true });
});
var auth_default = router;

// server/routes/admin.ts
import { Router as Router2 } from "express";
import { desc, eq as eq3, sql } from "drizzle-orm";
var router2 = Router2();
router2.use(isAdmin);
router2.get("/users", async (_req, res) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  res.json(rows);
});
router2.patch("/users/:id/admin", async (req, res) => {
  const { id } = req.params;
  const { isAdmin: newFlag } = req.body;
  await db.update(users).set({ isAdmin: Boolean(newFlag) }).where(eq3(users.id, id));
  audit({ req, action: "admin.toggle_admin", resourceType: "user", resourceId: id, detail: { isAdmin: newFlag } });
  res.json({ ok: true });
});
router2.get("/invites", async (_req, res) => {
  const rows = await db.select().from(invitedUsers).orderBy(desc(invitedUsers.createdAt));
  res.json(rows);
});
router2.post("/invites", async (req, res) => {
  const parsed = insertInviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const email = parsed.data.email.toLowerCase();
  const actor = req.user;
  const [created] = await db.insert(invitedUsers).values({ email, invitedBy: actor.id }).onConflictDoNothing().returning();
  audit({ req, action: "admin.invite_create", resourceType: "invite", detail: { email } });
  res.json(created ?? { email });
});
router2.delete("/invites/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(invitedUsers).where(eq3(invitedUsers.id, id));
  audit({ req, action: "admin.invite_delete", resourceType: "invite", resourceId: String(id) });
  res.json({ ok: true });
});
router2.get("/access-requests", async (_req, res) => {
  const rows = await db.select().from(accessRequests).orderBy(desc(accessRequests.createdAt));
  res.json(rows);
});
router2.patch("/access-requests/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const actor = req.user;
  const [updated] = await db.update(accessRequests).set({ status, decidedAt: /* @__PURE__ */ new Date(), decidedBy: actor.id }).where(eq3(accessRequests.id, id)).returning();
  if (updated && status === "approved") {
    await db.insert(invitedUsers).values({ email: updated.email.toLowerCase(), invitedBy: actor.id }).onConflictDoNothing();
  }
  audit({ req, action: "admin.access_request_decide", resourceType: "access_request", resourceId: String(id), detail: { status } });
  res.json(updated);
});
router2.get("/audit-logs", async (_req, res) => {
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(500);
  res.json(rows);
});
router2.get("/security-overview", async (_req, res) => {
  const [{ userCount }] = await db.select({ userCount: sql`count(*)::int` }).from(users);
  const [{ adminCount }] = await db.select({ adminCount: sql`count(*)::int` }).from(users).where(eq3(users.isAdmin, true));
  const [{ inviteCount }] = await db.select({ inviteCount: sql`count(*)::int` }).from(invitedUsers);
  const [{ pendingRequests }] = await db.select({ pendingRequests: sql`count(*)::int` }).from(accessRequests).where(eq3(accessRequests.status, "pending"));
  res.json({ userCount, adminCount, inviteCount, pendingRequests });
});
var admin_default = router2;

// server/routes/statements.ts
import { Router as Router3 } from "express";
import { z as z3 } from "zod";
import { and as and2, desc as desc3, eq as eq5 } from "drizzle-orm";

// server/modules/prompts/getPrompt.ts
import { and, desc as desc2, eq as eq4 } from "drizzle-orm";
async function getActivePrompt(promptKey) {
  const [row] = await db.select().from(systemPrompts).where(and(eq4(systemPrompts.promptKey, promptKey), eq4(systemPrompts.isActive, true))).limit(1);
  return row ?? null;
}
async function listPromptVersions(promptKey) {
  return db.select().from(systemPrompts).where(eq4(systemPrompts.promptKey, promptKey)).orderBy(desc2(systemPrompts.version));
}
async function listActivePrompts() {
  return db.select().from(systemPrompts).where(eq4(systemPrompts.isActive, true)).orderBy(systemPrompts.promptKey);
}

// server/modules/extraction/extract.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// server/modules/extraction/schema.ts
import { z as z2 } from "zod/v4";
var transactionSchema = z2.object({
  date: z2.string().describe("Transaction date in YYYY-MM-DD format"),
  description: z2.string().describe("Description exactly as it appears on the statement"),
  amount: z2.number().describe("Transaction amount as a positive number"),
  direction: z2.enum(["debit", "credit"]).describe("Whether money left or entered the account")
});
var extractionSchema = z2.object({
  accountHolderName: z2.string().nullable(),
  accountNumberMasked: z2.string().describe('Account number masked for display, e.g. "****4521"').nullable(),
  bankName: z2.string().nullable(),
  statementPeriodStart: z2.string().describe("Start date of statement period in YYYY-MM-DD").nullable(),
  statementPeriodEnd: z2.string().describe("End date of statement period in YYYY-MM-DD").nullable(),
  openingBalance: z2.number().nullable(),
  closingBalance: z2.number().nullable(),
  transactions: z2.array(transactionSchema),
  isValidBankStatement: z2.boolean().describe("False if this PDF does not appear to be a bank statement"),
  notes: z2.string().optional().describe("Any caveats, quality issues, or things flagged during extraction")
});

// server/modules/extraction/extract.ts
var client = new Anthropic();
async function extractStatement(input) {
  const response = await client.messages.parse({
    model: input.model,
    max_tokens: 16e3,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 }
          },
          {
            type: "text",
            text: "Extract the structured data from this bank statement PDF."
          }
        ]
      }
    ],
    output_config: {
      format: zodOutputFormat(extractionSchema)
    }
  });
  if (!response.parsed_output) {
    throw new Error("Extraction returned no parsed output");
  }
  return {
    result: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}

// server/routes/statements.ts
var router3 = Router3();
router3.use(isAuthenticated);
var uploadSchema = z3.object({
  filename: z3.string().min(1),
  pdfBase64: z3.string().min(1),
  sizeBytes: z3.number().int().nonnegative().optional(),
  contentHash: z3.string().length(64)
});
router3.post("/api/statements/upload", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const user = req.user;
  const [existing] = await db.select().from(statements).where(and2(eq5(statements.userId, user.id), eq5(statements.contentHash, parsed.data.contentHash))).limit(1);
  if (existing) {
    audit({
      req,
      action: "statement.upload_duplicate",
      resourceType: "statement",
      resourceId: String(existing.id)
    });
    return res.status(200).json({ ...existing, wasDuplicate: true });
  }
  const prompt = await getActivePrompt("extraction");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_extraction_prompt" });
  }
  const [created] = await db.insert(statements).values({
    userId: user.id,
    filename: parsed.data.filename,
    sizeBytes: parsed.data.sizeBytes,
    contentHash: parsed.data.contentHash,
    status: "extracting",
    promptVersionId: prompt.id
  }).returning();
  audit({ req, action: "statement.upload_start", resourceType: "statement", resourceId: String(created.id) });
  try {
    const { result, usage } = await extractStatement({
      pdfBase64: parsed.data.pdfBase64,
      systemPrompt: prompt.content,
      model: prompt.model
    });
    const [finished] = await db.update(statements).set({
      status: "extracted",
      extractionResult: result,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      completedAt: /* @__PURE__ */ new Date()
    }).where(eq5(statements.id, created.id)).returning();
    audit({
      req,
      action: "statement.extraction_success",
      resourceType: "statement",
      resourceId: String(created.id),
      detail: { usage }
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db.update(statements).set({ status: "failed", extractionError: message, completedAt: /* @__PURE__ */ new Date() }).where(eq5(statements.id, created.id));
    audit({
      req,
      action: "statement.extraction_failure",
      resourceType: "statement",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "extraction_failed", message });
  }
});
router3.get("/api/statements", async (req, res) => {
  const user = req.user;
  const rows = await db.select().from(statements).where(eq5(statements.userId, user.id)).orderBy(desc3(statements.createdAt));
  res.json(rows);
});
router3.get("/api/statements/:id", async (req, res) => {
  const user = req.user;
  const id = Number(req.params.id);
  const [row] = await db.select().from(statements).where(and2(eq5(statements.id, id), eq5(statements.userId, user.id)));
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});
var statements_default = router3;

// server/routes/prompts.ts
import { Router as Router4 } from "express";

// server/modules/prompts/savePrompt.ts
import { and as and3, desc as desc4, eq as eq6 } from "drizzle-orm";
async function savePromptVersion(input) {
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(systemPrompts).where(eq6(systemPrompts.promptKey, input.promptKey)).orderBy(desc4(systemPrompts.version)).limit(1);
    const nextVersion = prev ? prev.version + 1 : 1;
    await tx.update(systemPrompts).set({ isActive: false }).where(and3(eq6(systemPrompts.promptKey, input.promptKey), eq6(systemPrompts.isActive, true)));
    const [created] = await tx.insert(systemPrompts).values({
      promptKey: input.promptKey,
      label: input.label,
      description: input.description,
      model: input.model,
      content: input.content,
      version: nextVersion,
      isActive: true,
      createdBy: input.createdBy
    }).returning();
    return created;
  });
}
async function rollbackTo(promptKey, versionId) {
  return db.transaction(async (tx) => {
    await tx.update(systemPrompts).set({ isActive: false }).where(and3(eq6(systemPrompts.promptKey, promptKey), eq6(systemPrompts.isActive, true)));
    const [activated] = await tx.update(systemPrompts).set({ isActive: true }).where(and3(eq6(systemPrompts.id, versionId), eq6(systemPrompts.promptKey, promptKey))).returning();
    return activated;
  });
}

// server/routes/prompts.ts
var router4 = Router4();
router4.use(isAdmin);
router4.get("/prompts", async (_req, res) => {
  const rows = await listActivePrompts();
  res.json(rows);
});
router4.get("/prompts/:key/versions", async (req, res) => {
  const rows = await listPromptVersions(req.params.key);
  res.json(rows);
});
router4.post("/prompts", async (req, res) => {
  const parsed = savePromptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const actor = req.user;
  const created = await savePromptVersion({ ...parsed.data, createdBy: actor.id });
  audit({
    req,
    action: "admin.prompt_save",
    resourceType: "system_prompt",
    resourceId: String(created.id),
    detail: { promptKey: created.promptKey, version: created.version }
  });
  res.json(created);
});
router4.post("/prompts/:key/rollback/:id", async (req, res) => {
  const { key, id } = req.params;
  const activated = await rollbackTo(key, Number(id));
  audit({
    req,
    action: "admin.prompt_rollback",
    resourceType: "system_prompt",
    resourceId: id,
    detail: { promptKey: key, version: activated.version }
  });
  res.json(activated);
});
var prompts_default = router4;

// server/routes/analysis.ts
import { Router as Router5 } from "express";
import { and as and4, desc as desc5, eq as eq7 } from "drizzle-orm";

// server/modules/analysis/analyse.ts
import Anthropic2 from "@anthropic-ai/sdk";
import { zodOutputFormat as zodOutputFormat2 } from "@anthropic-ai/sdk/helpers/zod";

// server/modules/analysis/schema.ts
import { z as z4 } from "zod/v4";
var categorySchema = z4.object({
  category: z4.string().describe("Plain-language category name \u2014 'Food & groceries', 'Transport', 'Subscriptions', etc. Not dev-speak."),
  monthlyAverage: z4.number().describe("Rough average monthly spend in ZAR as a positive number"),
  percentOfSpend: z4.number().describe("Share of total monthly spend as a decimal 0-1"),
  examples: z4.array(z4.string()).describe("3-5 actual merchant or description examples from the statements")
});
var recurringSchema = z4.object({
  description: z4.string().describe("Description as it appears on statement \u2014 exact"),
  amount: z4.number().describe("ZAR amount, positive"),
  frequency: z4.string().describe('e.g. "monthly on 25th", "every 2nd month"'),
  category: z4.string()
});
var incomeSourceSchema = z4.object({
  description: z4.string(),
  monthlyAverage: z4.number(),
  frequency: z4.string().describe('e.g. "monthly", "irregular"')
});
var gapSchema = z4.object({
  key: z4.string().describe('Short slug \u2014 e.g. "retirement", "insurance", "crypto", "other_debt", "employer_benefits", "goals", "concerns"'),
  label: z4.string().describe("Human-readable label \u2014 'Retirement savings', 'Insurance cover', etc."),
  whyItMatters: z4.string().describe("One or two sentences in plain language explaining why this gap is worth closing"),
  questionToAsk: z4.string().describe("The specific conversational question to ask the user next, warm and curious, not interrogative")
});
var analysisSchema = z4.object({
  lifeSnapshot: z4.string().describe("A warm 2-3 sentence paragraph describing this person's financial life based on what the statements show. Observational and human \u2014 'Your money comes in once a month. Most of it goes out again within a fortnight.'"),
  income: z4.object({
    summary: z4.string().describe("Short narrative describing income \u2014 regularity, sources, variability. Plain language, warm, not clinical."),
    monthlyAverage: z4.number().nullable().describe("Average monthly income across the period, ZAR"),
    regularity: z4.enum(["steady", "variable", "irregular"]),
    sources: z4.array(incomeSourceSchema)
  }),
  spending: z4.object({
    summary: z4.string().describe("Short narrative describing the shape of spending \u2014 calm, non-judgemental."),
    monthlyAverage: z4.number().nullable(),
    byCategory: z4.array(categorySchema).describe("Categories sorted by monthlyAverage descending")
  }),
  savings: z4.object({
    summary: z4.string().describe("A single observation about savings behaviour \u2014 what's happening or what isn't. No lecturing."),
    monthlyAverageSaved: z4.number().nullable().describe("Can be negative if outflows exceed inflows. Null if unclear."),
    observation: z4.string().describe("One sentence \u2014 plain, honest, hopeful.")
  }),
  recurring: z4.array(recurringSchema).describe("Debit orders / subscriptions / regular outflows detected"),
  gaps: z4.array(gapSchema).describe("What the statements cannot show but we need to understand the full picture. Typical gaps: retirement, insurance, crypto, undisclosed debt, employer benefits, goals, concerns. Prioritise the 5-8 most important."),
  notes: z4.string().optional().describe("Anything else worth flagging \u2014 unusual patterns, data quality caveats, etc.")
});

// server/modules/analysis/analyse.ts
var client2 = new Anthropic2();
async function analyseStatements(input) {
  const body = buildUserMessage(input.statements);
  const response = await client2.messages.parse({
    model: input.model,
    max_tokens: 16e3,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: body
      }
    ],
    output_config: { format: zodOutputFormat2(analysisSchema) }
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
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}
function buildUserMessage(statements2) {
  const header = `You are being given ${statements2.length} extracted bank statements covering a period of months. Analyse the whole set together, not one at a time.

`;
  const body = statements2.map((s, i) => `## Statement ${i + 1} \u2014 ${s.filename}
\`\`\`json
${JSON.stringify(s.extraction, null, 2)}
\`\`\``).join("\n\n");
  return header + body;
}

// server/routes/analysis.ts
var router5 = Router5();
router5.use(isAuthenticated);
router5.get("/api/analysis/latest", async (req, res) => {
  const user = req.user;
  const [row] = await db.select().from(analyses).where(eq7(analyses.userId, user.id)).orderBy(desc5(analyses.createdAt)).limit(1);
  res.json(row ?? null);
});
router5.post("/api/analysis/run", async (req, res) => {
  const user = req.user;
  const sts = await db.select().from(statements).where(and4(eq7(statements.userId, user.id), eq7(statements.status, "extracted")));
  if (sts.length === 0) {
    return res.status(400).json({ error: "no_statements" });
  }
  const prompt = await getActivePrompt("analysis");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_analysis_prompt" });
  }
  const [created] = await db.insert(analyses).values({
    userId: user.id,
    status: "analysing",
    promptVersionId: prompt.id,
    sourceStatementIds: sts.map((s) => s.id)
  }).returning();
  audit({ req, action: "analysis.start", resourceType: "analysis", resourceId: String(created.id) });
  try {
    const { result, usage } = await analyseStatements({
      systemPrompt: prompt.content,
      model: prompt.model,
      statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult }))
    });
    const [finished] = await db.update(analyses).set({
      status: "done",
      result,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      completedAt: /* @__PURE__ */ new Date()
    }).where(eq7(analyses.id, created.id)).returning();
    audit({
      req,
      action: "analysis.success",
      resourceType: "analysis",
      resourceId: String(created.id),
      detail: { usage }
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db.update(analyses).set({ status: "failed", errorMessage: message, completedAt: /* @__PURE__ */ new Date() }).where(eq7(analyses.id, created.id));
    audit({
      req,
      action: "analysis.failure",
      resourceType: "analysis",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "analysis_failed", message });
  }
});
var analysis_default = router5;

// server/routes/qa.ts
import { Router as Router6 } from "express";
import { z as z6 } from "zod";
import { and as and6, asc, desc as desc6, eq as eq9 } from "drizzle-orm";

// server/modules/qa/persistTurn.ts
import { and as and5, eq as eq8 } from "drizzle-orm";

// server/modules/qa/chat.ts
import Anthropic3 from "@anthropic-ai/sdk";
import { zodOutputFormat as zodOutputFormat3 } from "@anthropic-ai/sdk/helpers/zod";

// server/modules/qa/schema.ts
import { z as z5 } from "zod/v4";
var qaProfileSchema = z5.object({
  corrections: z5.array(z5.string()).describe("Things the user said were wrong in their story. Short statements, one per correction."),
  otherAccounts: z5.string().describe("Notes on accounts not visible in the uploaded statements (other banks, savings, investments, credit cards). Empty string if not yet discussed."),
  incomeContext: z5.string().describe("Notes on income stability, source concentration, side income. Empty string if not yet discussed."),
  debt: z5.string().describe("Notes on debts not visible in statements (store accounts, family loans, other bank credit cards). Empty string if not yet discussed."),
  medicalCover: z5.string().describe("Notes on medical aid / hospital cover status. Empty string if not yet discussed."),
  lifeCover: z5.string().describe("Notes on life cover and who depends on the user's income. Empty string if not yet discussed."),
  incomeProtection: z5.string().describe("Notes on income protection cover. Empty string if not yet discussed."),
  retirement: z5.string().describe("Notes on retirement savings \u2014 RA, employer fund, provident fund, etc. Empty string if not yet discussed."),
  tax: z5.string().describe("Notes on tax situation \u2014 PAYE, provisional, VAT, company salary. Empty string if not yet discussed."),
  property: z5.string().describe("Notes on property ownership, bonds, rental. Empty string if not yet discussed."),
  goals: z5.array(z5.string()).describe("What the user wants \u2014 VERBATIM in their own words. Do not reword into financial jargon."),
  lifeContext: z5.string().describe("Notes on dependents, partner, living situation, life stage. Empty string if not yet discussed."),
  will: z5.string().describe("Notes on will / estate planning. Empty string if not yet discussed.")
});
var qaProfileUpdateSchema = qaProfileSchema;
var qaTurnResultSchema = z5.object({
  reply: z5.string().describe(
    "What to say back to the user. Short \u2014 a few sentences, never a wall of text. No formatting (no bullets, bold, headers, lists). Conversational. One question at a time, never two."
  ),
  profileUpdates: qaProfileUpdateSchema.describe(
    "Your full current view of the profile. For topics you didn't address this turn, pass an empty string (or empty array for corrections/goals). The server merges: non-empty strings overwrite existing notes, arrays are appended and deduped."
  ),
  newFlaggedIssues: z5.array(z5.string()).describe(
    "NEW key issues to flag from what the user just said. One short sentence each. Do not repeat previously flagged issues. Empty array if nothing new to flag."
  ),
  status: z5.enum(["continuing", "minimum_viable", "complete"]).describe(
    "continuing = more to gather; minimum_viable = enough for a picture but could gather more; complete = nothing essential left to gather."
  )
});
function emptyProfile() {
  return {
    corrections: [],
    otherAccounts: "",
    incomeContext: "",
    debt: "",
    medicalCover: "",
    lifeCover: "",
    incomeProtection: "",
    retirement: "",
    tax: "",
    property: "",
    goals: [],
    lifeContext: "",
    will: ""
  };
}

// server/modules/qa/chat.ts
var client3 = new Anthropic3();
async function runQaTurn(input) {
  const { stable, dynamic } = buildContextBlocks(input);
  const response = await client3.messages.parse({
    model: input.model,
    max_tokens: 2e3,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamic }
        ]
      },
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      ...input.latestUser !== null ? [{ role: "user", content: input.latestUser }] : []
    ],
    output_config: { format: zodOutputFormat3(qaTurnResultSchema) }
  });
  if (!response.parsed_output) {
    throw new Error("QA turn returned no parsed output");
  }
  return {
    result: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}
function buildContextBlocks(input) {
  const stable = buildStableContext(input);
  const dynamic = buildDynamicContext(input);
  return { stable, dynamic };
}
function buildStableContext(input) {
  const who = input.user.firstName ? `You're speaking with ${input.user.firstName}.` : `You're speaking with a user whose first name you don't know \u2014 avoid using a name.`;
  const statementsBlock = input.statements.length === 0 ? "(no statements uploaded yet)" : input.statements.map((s) => formatStatementLine(s)).join("\n");
  const sections = [who, "", `## Current phase: ${input.phase}`];
  if (input.phase === "bring_it_in") {
    sections.push(
      "They are uploading statements. You do NOT have an analysis yet \u2014 don't pretend to. Your job here is to reassure, answer process questions (why statements, what format, what if they have fewer than 12, privacy), and encourage them to keep uploading. Do NOT drive through gaps yet \u2014 that's for the next phase."
    );
  } else if (input.phase === "analysing") {
    sections.push(
      `They've finished uploading and clicked "show me my picture". The analysis is running in the background right now and will finish shortly. You do NOT have the analysis yet. Do NOT ask for more statements \u2014 they're done with that. Do NOT drive through gaps \u2014 you don't have the story yet. If they ask what to do next, tell them the analysis is running (should take about a minute) and then you'll go through the story together. Stay light.`
    );
  } else {
    sections.push(
      "They've uploaded statements and the analysis has run. The story on the left is yours. Your job now is to drive through the gaps \u2014 corrections first, then what statements couldn't show, then safety nets, goals, life context."
    );
  }
  sections.push("", "## Statements so far", statementsBlock, "");
  if (input.analysis) {
    sections.push(
      "## Their financial story (from the Analysis phase)",
      "```json",
      JSON.stringify(input.analysis, null, 2),
      "```",
      ""
    );
  }
  return sections.join("\n");
}
function buildDynamicContext(input) {
  const sections = [
    "## What you've already learned from them (running profile)",
    "```json",
    JSON.stringify(input.profile, null, 2),
    "```",
    "",
    "## Issues you've already flagged (don't repeat these)",
    input.flaggedIssues.length === 0 ? "(none yet)" : input.flaggedIssues.map((f) => `- ${f}`).join("\n"),
    ""
  ];
  if (input.historyTruncated) {
    sections.push(
      "## Memory note",
      "Earlier turns of this conversation have been trimmed \u2014 you only see the recent messages below. Everything meaningful from earlier is captured in the running profile above. If the user references something older that isn't in the profile, it's fine to ask again.",
      ""
    );
  }
  const opening = input.latestUser === null ? input.phase === "first_take_gaps" ? "The conversation hasn't started yet. Greet them warmly, acknowledge the story they've just read, state privacy in one line, set the expectation that this takes about 10 minutes, and ask your first correction-check question." : input.phase === "analysing" ? "The conversation hasn't started yet. Greet them warmly and tell them the analysis is running \u2014 it'll be ready in a minute." : "The conversation hasn't started yet. Greet them warmly, explain in one or two sentences why you need their bank statements, and invite them to drop pdfs on the left. Privacy in one line. Ask if they have any questions before they start." : "The conversation history follows. Respond to their most recent message.";
  sections.push(opening);
  return sections.join("\n");
}
function formatStatementLine(s) {
  if (s.status === "extracted") {
    const bits = [s.filename];
    if (s.bankName) bits.push(s.bankName);
    if (s.periodStart && s.periodEnd) bits.push(`${s.periodStart} \u2192 ${s.periodEnd}`);
    if (s.transactionCount != null) bits.push(`${s.transactionCount} transactions`);
    return `- ${bits.join(" \xB7 ")}`;
  }
  return `- ${s.filename} (${s.status})`;
}

// server/modules/qa/mergeProfile.ts
function mergeProfile(existing, updates) {
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
    will: preferUpdate(existing.will, updates.will)
  };
}
function mergeFlaggedIssues(existing, incoming) {
  if (!incoming || incoming.length === 0) return existing;
  return concatDedup(existing, incoming);
}
function preferUpdate(existing, update) {
  if (typeof update !== "string") return existing;
  return update.trim().length > 0 ? update : existing;
}
function concatDedup(existing, incoming) {
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

// server/modules/qa/persistTurn.ts
async function runAndPersistTurn(input) {
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
    latestUser: input.latestUser
  });
  const [assistantMessage] = await db.insert(conversationMessages).values({
    conversationId: input.conversationId,
    role: "assistant",
    content: result.reply,
    profileUpdates: result.profileUpdates,
    status: result.status,
    isTransition: input.isTransition ?? false,
    promptVersionId: input.prompt.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens
  }).returning();
  const mergedProfile = mergeProfile(input.profile, result.profileUpdates);
  const mergedFlags = mergeFlaggedIssues(input.flaggedIssues, result.newFlaggedIssues);
  const newStatus = result.status === "complete" ? "complete" : "active";
  const [conversation] = await db.update(conversations).set({
    profile: mergedProfile,
    flaggedIssues: mergedFlags,
    status: newStatus,
    updatedAt: /* @__PURE__ */ new Date(),
    completedAt: newStatus === "complete" ? /* @__PURE__ */ new Date() : null
  }).where(and5(eq8(conversations.id, input.conversationId), eq8(conversations.userId, input.userId))).returning();
  return { conversation, assistantMessage };
}

// server/routes/qa.ts
function derivePhase(buildCompletedAt, analysisResult) {
  if (!buildCompletedAt) return "bring_it_in";
  if (!analysisResult) return "analysing";
  return "first_take_gaps";
}
function summariseStatements(rows) {
  return rows.map((s) => {
    const r = s.extractionResult ?? null;
    return {
      filename: s.filename,
      status: s.status,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null
    };
  });
}
var router6 = Router6();
router6.use(isAuthenticated);
var messageBodySchema = z6.object({
  content: z6.string().min(1).max(5e3)
});
var MAX_HISTORY_MESSAGES = 12;
router6.get("/api/qa/conversation", async (req, res) => {
  const user = req.user;
  const [conversation] = await db.select().from(conversations).where(eq9(conversations.userId, user.id)).limit(1);
  if (!conversation) {
    return res.json({ conversation: null, messages: [] });
  }
  const [latestAnalysis] = await db.select().from(analyses).where(and6(eq9(analyses.userId, user.id), eq9(analyses.status, "done"))).orderBy(desc6(analyses.createdAt)).limit(1);
  const currentPhase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const needsTransitionOpener = currentPhase === "first_take_gaps" && latestAnalysis?.id !== void 0 && latestAnalysis.id !== conversation.analysisIdAtStart;
  if (needsTransitionOpener && latestAnalysis?.result) {
    const prompt = await getActivePrompt("qa");
    if (prompt) {
      const userStatements = await db.select().from(statements).where(eq9(statements.userId, user.id));
      const runningProfile = conversation.profile ?? emptyProfile();
      const runningFlags = conversation.flaggedIssues ?? [];
      try {
        await runAndPersistTurn({
          conversationId: conversation.id,
          userId: user.id,
          prompt,
          user: { firstName: user.firstName, email: user.email },
          phase: currentPhase,
          analysis: latestAnalysis.result,
          statements: summariseStatements(userStatements),
          profile: runningProfile,
          flaggedIssues: runningFlags,
          history: [],
          historyTruncated: false,
          latestUser: null,
          isTransition: true
        });
        await db.update(conversations).set({ analysisIdAtStart: latestAnalysis.id, updatedAt: /* @__PURE__ */ new Date() }).where(eq9(conversations.id, conversation.id));
        audit({
          req,
          action: "qa.phase_transition_opener",
          resourceType: "conversation",
          resourceId: String(conversation.id),
          detail: { phase: currentPhase, analysisId: latestAnalysis.id }
        });
      } catch (err) {
        console.error("[qa.conversation] transition opener failed:", err);
      }
    }
  }
  const [refreshed] = await db.select().from(conversations).where(eq9(conversations.id, conversation.id)).limit(1);
  const messages = await loadMessages(conversation.id);
  res.json({ conversation: refreshed ?? conversation, messages });
});
router6.post("/api/qa/start", async (req, res) => {
  const user = req.user;
  const [existing] = await db.select().from(conversations).where(eq9(conversations.userId, user.id)).limit(1);
  if (existing) {
    const existingMessages = await loadMessages(existing.id);
    if (existingMessages.length > 0) {
      return res.json({ conversation: existing, messages: existingMessages });
    }
  }
  const [latestAnalysis] = await db.select().from(analyses).where(and6(eq9(analyses.userId, user.id), eq9(analyses.status, "done"))).orderBy(desc6(analyses.createdAt)).limit(1);
  const userStatements = await db.select().from(statements).where(eq9(statements.userId, user.id));
  const phase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const promptKey = phase === "first_take_gaps" ? "qa" : "qa_bring_it_in";
  const prompt = await getActivePrompt(promptKey);
  if (!prompt) {
    return res.status(500).json({ error: "no_active_qa_prompt", detail: { promptKey } });
  }
  const profile = emptyProfile();
  const created = existing ? existing : (await db.insert(conversations).values({
    userId: user.id,
    status: "active",
    profile,
    flaggedIssues: [],
    analysisIdAtStart: latestAnalysis?.id ?? null
  }).returning())[0];
  audit({
    req,
    action: existing ? "qa.conversation_restart_opener" : "qa.conversation_start",
    resourceType: "conversation",
    resourceId: String(created.id),
    detail: { analysisId: latestAnalysis?.id ?? null }
  });
  try {
    const { conversation, assistantMessage } = await runAndPersistTurn({
      conversationId: created.id,
      userId: user.id,
      prompt,
      user: { firstName: user.firstName, email: user.email },
      phase,
      analysis: latestAnalysis?.result ?? null,
      statements: summariseStatements(userStatements),
      profile,
      flaggedIssues: [],
      history: [],
      historyTruncated: false,
      latestUser: null,
      isTransition: true
    });
    res.json({ conversation, messages: [assistantMessage] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[qa.start] Claude call failed:", err);
    audit({
      req,
      action: "qa.conversation_start_failed",
      resourceType: "conversation",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "qa_start_failed", message });
  }
});
router6.post("/api/qa/message", async (req, res) => {
  const user = req.user;
  const parsed = messageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [conversation] = await db.select().from(conversations).where(eq9(conversations.userId, user.id)).limit(1);
  if (!conversation) {
    return res.status(404).json({ error: "no_conversation" });
  }
  if (conversation.status === "complete") {
    return res.status(400).json({ error: "conversation_complete" });
  }
  const [latestAnalysis] = await db.select().from(analyses).where(and6(eq9(analyses.userId, user.id), eq9(analyses.status, "done"))).orderBy(desc6(analyses.createdAt)).limit(1);
  const userStatements = await db.select().from(statements).where(eq9(statements.userId, user.id));
  const phase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const promptKey = phase === "first_take_gaps" ? "qa" : "qa_bring_it_in";
  const prompt = await getActivePrompt(promptKey);
  if (!prompt) {
    return res.status(500).json({ error: "no_active_qa_prompt", detail: { promptKey } });
  }
  const [userMsg] = await db.insert(conversationMessages).values({
    conversationId: conversation.id,
    role: "user",
    content: parsed.data.content
  }).returning();
  audit({
    req,
    action: "qa.message_send",
    resourceType: "conversation",
    resourceId: String(conversation.id)
  });
  const priorMessages = await loadMessages(conversation.id);
  const fullHistory = priorMessages.filter((m) => m.id !== userMsg.id).map((m) => ({ role: m.role, content: m.content }));
  const historyForModel = fullHistory.slice(-MAX_HISTORY_MESSAGES);
  const historyTruncated = fullHistory.length > historyForModel.length;
  const runningProfile = conversation.profile ?? emptyProfile();
  const runningFlags = conversation.flaggedIssues ?? [];
  try {
    const { conversation: updated, assistantMessage } = await runAndPersistTurn({
      conversationId: conversation.id,
      userId: user.id,
      prompt,
      user: { firstName: user.firstName, email: user.email },
      analysis: latestAnalysis?.result ?? null,
      statements: summariseStatements(userStatements),
      profile: runningProfile,
      flaggedIssues: runningFlags,
      history: historyForModel,
      historyTruncated,
      latestUser: parsed.data.content
    });
    if (updated.status === "complete") {
      audit({
        req,
        action: "qa.conversation_complete",
        resourceType: "conversation",
        resourceId: String(conversation.id)
      });
    }
    res.json({ conversation: updated, userMessage: userMsg, assistantMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[qa.message] Claude call failed:", err);
    audit({
      req,
      action: "qa.message_failed",
      resourceType: "conversation",
      resourceId: String(conversation.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "qa_message_failed", message });
  }
});
router6.post("/api/qa/pause", async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(conversations).set({ status: "paused", updatedAt: /* @__PURE__ */ new Date() }).where(and6(eq9(conversations.userId, user.id), eq9(conversations.status, "active"))).returning();
  if (!updated) {
    return res.status(404).json({ error: "no_active_conversation" });
  }
  audit({
    req,
    action: "qa.conversation_pause",
    resourceType: "conversation",
    resourceId: String(updated.id)
  });
  res.json(updated);
});
router6.post("/api/qa/complete", async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(conversations).set({ status: "complete", completedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq9(conversations.userId, user.id)).returning();
  if (!updated) {
    return res.status(404).json({ error: "no_conversation" });
  }
  audit({
    req,
    action: "qa.conversation_complete",
    resourceType: "conversation",
    resourceId: String(updated.id),
    detail: { source: "manual" }
  });
  res.json(updated);
});
async function loadMessages(conversationId) {
  return db.select().from(conversationMessages).where(eq9(conversationMessages.conversationId, conversationId)).orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
}
var qa_default = router6;

// server/routes/index.ts
function registerRoutes(app2) {
  app2.use(auth_default);
  app2.use("/api/admin", admin_default);
  app2.use("/api/admin", prompts_default);
  app2.use(statements_default);
  app2.use(analysis_default);
  app2.use(qa_default);
}

// server/api.ts
var app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: [process.env.PUBLIC_URL ?? ""],
    credentials: true
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  "/api",
  rateLimit({ windowMs: 15 * 60 * 1e3, limit: 200, standardHeaders: true, legacyHeaders: false })
);
setupAuth(app);
registerRoutes(app);
app.use((err, _req, res, _next) => {
  console.error("[api] error:", err);
  res.status(500).json({ error: "internal_error" });
});
var api_default = app;
export {
  api_default as default
};
