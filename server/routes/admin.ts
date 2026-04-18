import { Router } from "express";
import { db } from "../db";
import { users, invitedUsers, accessRequests, auditLogs, insertInviteSchema } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { audit } from "../auditLog";
import { isAdmin } from "../auth";

// Mounted at /api/admin — so all paths here are relative to that.
const router = Router();
router.use(isAdmin);

router.get("/users", async (_req, res) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  res.json(rows);
});

router.patch("/users/:id/admin", async (req, res) => {
  const { id } = req.params;
  const { isAdmin: newFlag } = req.body as { isAdmin: boolean };
  await db.update(users).set({ isAdmin: Boolean(newFlag) }).where(eq(users.id, id));
  audit({ req, action: "admin.toggle_admin", resourceType: "user", resourceId: id, detail: { isAdmin: newFlag } });
  res.json({ ok: true });
});

router.get("/invites", async (_req, res) => {
  const rows = await db.select().from(invitedUsers).orderBy(desc(invitedUsers.createdAt));
  res.json(rows);
});

router.post("/invites", async (req, res) => {
  const parsed = insertInviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const email = parsed.data.email.toLowerCase();
  const actor = req.user as { id: string };
  const [created] = await db
    .insert(invitedUsers)
    .values({ email, invitedBy: actor.id })
    .onConflictDoNothing()
    .returning();
  audit({ req, action: "admin.invite_create", resourceType: "invite", detail: { email } });
  res.json(created ?? { email });
});

router.delete("/invites/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(invitedUsers).where(eq(invitedUsers.id, id));
  audit({ req, action: "admin.invite_delete", resourceType: "invite", resourceId: String(id) });
  res.json({ ok: true });
});

router.get("/access-requests", async (_req, res) => {
  const rows = await db.select().from(accessRequests).orderBy(desc(accessRequests.createdAt));
  res.json(rows);
});

router.patch("/access-requests/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: "approved" | "declined" };
  const actor = req.user as { id: string };

  const [updated] = await db
    .update(accessRequests)
    .set({ status, decidedAt: new Date(), decidedBy: actor.id })
    .where(eq(accessRequests.id, id))
    .returning();

  if (updated && status === "approved") {
    await db
      .insert(invitedUsers)
      .values({ email: updated.email.toLowerCase(), invitedBy: actor.id })
      .onConflictDoNothing();
  }

  audit({ req, action: "admin.access_request_decide", resourceType: "access_request", resourceId: String(id), detail: { status } });
  res.json(updated);
});

router.get("/audit-logs", async (_req, res) => {
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(500);
  res.json(rows);
});

router.get("/security-overview", async (_req, res) => {
  const [{ userCount }] = await db
    .select({ userCount: sql<number>`count(*)::int` })
    .from(users);
  const [{ adminCount }] = await db
    .select({ adminCount: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.isAdmin, true));
  const [{ inviteCount }] = await db
    .select({ inviteCount: sql<number>`count(*)::int` })
    .from(invitedUsers);
  const [{ pendingRequests }] = await db
    .select({ pendingRequests: sql<number>`count(*)::int` })
    .from(accessRequests)
    .where(eq(accessRequests.status, "pending"));

  res.json({ userCount, adminCount, inviteCount, pendingRequests });
});

export default router;
