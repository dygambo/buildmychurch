import { and, asc, desc, eq, ilike, isNull, or, sql, gt } from "drizzle-orm";
import type { Tx } from "../db";
import { auditLogs, authTokens, branches, memberships, organisations, roles, users } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { ALL_PERMISSIONS, type Permission } from "../auth/permissions";
import { audit, diff } from "../audit";
import { AppError, notFound } from "../errors";
import { createInvite } from "./accounts";
import { enqueue } from "../jobs/queue";
import { emailLayout, p } from "../emails/layout";
import { firstName } from "@/lib/format";
import { env } from "../env";
import { normalizeNgPhone } from "@/lib/phone";

/* ---------- church profile ---------- */
export async function getOrg(tx: Tx, ctx: Actor) {
  const [o] = await tx.select().from(organisations).where(eq(organisations.id, ctx.org.id));
  return o!;
}

export async function updateOrg(
  tx: Tx,
  ctx: Actor,
  input: {
    name: string;
    denomination?: string;
    state?: string;
    lga?: string;
    address?: string;
    phone?: string;
    email?: string;
    smsSenderId?: string;
  },
) {
  assertCan(ctx, "settings.manage", "change church settings");
  const before = await getOrg(tx, ctx);
  const phone = input.phone ? normalizeNgPhone(input.phone) : null;
  if (input.phone && !phone)
    throw new AppError("Enter a valid Nigerian phone number.", { phone: "Enter a valid phone number." });
  if (input.smsSenderId && !/^[A-Za-z0-9 ]{3,11}$/.test(input.smsSenderId))
    throw new AppError("SMS sender IDs are 3 to 11 letters or numbers.", {
      smsSenderId: "3–11 letters or numbers, no symbols.",
    });
  const patch = {
    name: input.name,
    denomination: input.denomination || null,
    state: input.state || null,
    lga: input.lga || null,
    address: input.address || null,
    phone,
    email: input.email || null,
    smsSenderId: input.smsSenderId || null,
  };
  const d = diff(before as unknown as Record<string, unknown>, patch);
  if (!d.changed.length) return;
  await tx.update(organisations).set(patch).where(eq(organisations.id, ctx.org.id));
  await audit(tx, ctx, {
    action: "org.updated",
    summary: `Updated church profile (${d.changed.join(", ")})`,
    entityType: "organisation",
    entityId: ctx.org.id,
    before: d.before,
    after: d.after,
  });
}

/* ---------- branches ---------- */
export async function listBranches(tx: Tx, includeArchived = false) {
  return tx
    .select()
    .from(branches)
    .where(includeArchived ? undefined : isNull(branches.archivedAt))
    .orderBy(asc(branches.path));
}

export async function saveBranch(
  tx: Tx,
  ctx: Actor,
  input: {
    id?: string;
    name: string;
    code: string;
    parentId?: string | null;
    address?: string;
    phone?: string;
    pastorName?: string;
  },
) {
  assertCan(ctx, "branches.manage", "manage branches");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(code))
    throw new AppError("Branch codes are 2–10 letters or numbers.", { code: "2–10 letters or numbers, e.g. WUSE." });
  const all = await listBranches(tx, true);
  if (all.some((b) => b.code === code && b.id !== input.id))
    throw new AppError(`Another branch already uses the code ${code}.`, { code: "Already used." });
  const parent = input.parentId ? all.find((b) => b.id === input.parentId) : all.find((b) => b.level === "hq");
  if (
    input.id &&
    parent &&
    (parent.id === input.id || parent.path.startsWith(all.find((b) => b.id === input.id)!.path + "."))
  )
    throw new AppError("A branch can't sit under itself.", { parentId: "Choose a different parent." });
  const path = parent ? `${parent.path}.${code.toLowerCase()}` : code.toLowerCase();
  const values = {
    name: input.name.trim(),
    code,
    parentId: parent?.id ?? null,
    path,
    address: input.address || null,
    phone: input.phone || null,
    pastorName: input.pastorName || null,
  };
  if (input.id) {
    const before = all.find((b) => b.id === input.id);
    if (!before) throw notFound("That branch");
    if (before.level === "hq") Object.assign(values, { parentId: null, path: before.path });
    await tx.update(branches).set(values).where(eq(branches.id, input.id));
    if (before.path !== values.path) {
      // keep descendants' paths in step
      await tx.execute(
        sql`update branches set path = ${values.path} || substr(path, ${before.path.length + 1}) where path like ${before.path + ".%"}`,
      );
    }
    await audit(tx, ctx, {
      action: "branch.updated",
      summary: `Updated branch ${values.name}`,
      entityType: "branch",
      entityId: input.id,
    });
    return input.id;
  }
  const [b] = await tx
    .insert(branches)
    .values({ ...values, orgId: ctx.org.id, level: "branch" })
    .returning();
  await audit(tx, ctx, {
    action: "branch.created",
    summary: `Added branch ${b!.name} (${b!.code})`,
    entityType: "branch",
    entityId: b!.id,
  });
  return b!.id;
}

export async function archiveBranch(tx: Tx, ctx: Actor, id: string, archived: boolean) {
  assertCan(ctx, "branches.manage", "manage branches");
  const [b] = await tx.select().from(branches).where(eq(branches.id, id));
  if (!b) throw notFound("That branch");
  if (b.level === "hq") throw new AppError("Headquarters can't be archived.");
  await tx
    .update(branches)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(branches.id, id));
  await audit(tx, ctx, {
    action: archived ? "branch.archived" : "branch.restored",
    summary: `${archived ? "Archived" : "Restored"} branch ${b.name}`,
    entityType: "branch",
    entityId: id,
  });
}

/* ---------- team ---------- */
export async function listTeam(tx: Tx, ctx: Actor) {
  const people = await tx
    .select({
      m: memberships,
      u: {
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        mfaEnabled: users.mfaEnabled,
        lastLoginAt: users.lastLoginAt,
      },
      r: { id: roles.id, name: roles.name, key: roles.key },
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(eq(memberships.orgId, ctx.org.id))
    .orderBy(asc(users.name));
  const invites = await tx
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.orgId, ctx.org.id),
        eq(authTokens.purpose, "invite"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authTokens.createdAt));
  return { people, invites };
}

export async function listRoles(tx: Tx, ctx: Actor) {
  return tx.select().from(roles).where(eq(roles.orgId, ctx.org.id)).orderBy(asc(roles.createdAt));
}

export async function inviteStaff(
  tx: Tx,
  ctx: Actor,
  input: { email: string; name: string; roleId: string; branchIds: string[]; title?: string },
) {
  assertCan(ctx, "users.manage", "invite staff");
  const [role] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.id, input.roleId), eq(roles.orgId, ctx.org.id)));
  if (!role) throw new AppError("Choose a role.", { roleId: "Choose a role." });
  if (role.key === "owner" && ctx.membership.roleKey !== "owner")
    throw new AppError("Only a Super Admin can invite another Super Admin.");
  const email = input.email.trim().toLowerCase();
  const [already] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.org.id), eq(users.email, email)));
  if (already) throw new AppError(`${email} is already on your team.`, { email: "Already on the team." });
  const token = await createInvite(ctx.org.id, { ...input, email }, ctx.user);
  const url = `${env().APP_URL}/invite/${token}`;
  await enqueue(
    tx,
    "email.send",
    {
      to: email,
      subject: `${ctx.user.name} invited you to ${ctx.org.name} on Build My Church`,
      html: emailLayout({
        church: ctx.org.name,
        heading: `Join the ${ctx.org.name} team`,
        bodyHtml:
          p(
            `Hi ${firstName(input.name)}, ${ctx.user.name} has invited you to help manage ${ctx.org.name} as ${role.name}.`,
          ) + p("The invitation is valid for 7 days."),
        button: { label: "Accept invitation", url },
      }),
    },
    { orgId: ctx.org.id },
  );
  await audit(tx, ctx, {
    action: "user.invited",
    summary: `Invited ${input.name} (${email}) as ${role.name}`,
    entityType: "invite",
    entityId: email,
  });
  return url;
}

export async function revokeInvite(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "users.manage", "manage invitations");
  const [t] = await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, id), eq(authTokens.orgId, ctx.org.id)))
    .returning();
  if (!t) throw notFound("That invitation");
  await audit(tx, ctx, {
    action: "invite.revoked",
    summary: `Cancelled the invitation to ${t.email}`,
    entityType: "invite",
    entityId: t.email ?? id,
  });
}

export async function updateMembership(
  tx: Tx,
  ctx: Actor,
  input: {
    membershipId: string;
    roleId: string;
    branchIds: string[];
    status: "active" | "disabled";
    title?: string;
    staffId?: string;
  },
) {
  assertCan(ctx, "users.manage", "change roles");
  const [m] = await tx
    .select({ m: memberships, r: roles, u: users })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.orgId, ctx.org.id)));
  if (!m) throw notFound("That team member");
  const [newRole] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.id, input.roleId), eq(roles.orgId, ctx.org.id)));
  if (!newRole) throw new AppError("Choose a role.");
  if ((m.r.key === "owner" || newRole.key === "owner") && ctx.membership.roleKey !== "owner")
    throw new AppError("Only a Super Admin can change a Super Admin.");
  if (m.r.key === "owner" && (newRole.key !== "owner" || input.status === "disabled")) {
    const owners = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.orgId, ctx.org.id), eq(roles.key, "owner"), eq(memberships.status, "active")));
    if (owners.length <= 1)
      throw new AppError("Every church needs at least one active Super Admin. Make someone else Super Admin first.");
  }
  await tx
    .update(memberships)
    .set({
      roleId: input.roleId,
      branchIds: input.branchIds,
      status: input.status,
      title: input.title || null,
      staffId: input.staffId || null,
    })
    .where(eq(memberships.id, input.membershipId));
  await audit(tx, ctx, {
    action: "user.updated",
    summary: `${input.status === "disabled" ? "Disabled" : "Updated"} ${m.u.name}: role ${m.r.name} → ${newRole.name}`,
    entityType: "user",
    entityId: m.u.id,
    before: { role: m.r.name, branchIds: m.m.branchIds, status: m.m.status },
    after: { role: newRole.name, branchIds: input.branchIds, status: input.status },
  });
}

export async function saveRole(
  tx: Tx,
  ctx: Actor,
  input: { id?: string; name: string; description?: string; permissions: string[] },
) {
  assertCan(ctx, "users.manage", "edit roles");
  const perms = input.permissions.filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
  if (input.id) {
    const [r] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, input.id), eq(roles.orgId, ctx.org.id)));
    if (!r) throw notFound("That role");
    if (r.key === "owner") throw new AppError("The Super Admin role always has every permission.");
    await tx
      .update(roles)
      .set({ name: input.name, description: input.description || null, permissions: perms })
      .where(eq(roles.id, r.id));
    await audit(tx, ctx, {
      action: "role.updated",
      summary: `Changed permissions for ${input.name}`,
      entityType: "role",
      entityId: r.id,
      before: { permissions: r.permissions },
      after: { permissions: perms },
    });
    return r.id;
  }
  const key =
    "custom_" +
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 30) +
    "_" +
    Math.random().toString(36).slice(2, 6);
  const [r] = await tx
    .insert(roles)
    .values({ orgId: ctx.org.id, key, name: input.name, description: input.description || null, permissions: perms })
    .returning();
  await audit(tx, ctx, {
    action: "role.created",
    summary: `Created role ${input.name}`,
    entityType: "role",
    entityId: r!.id,
  });
  return r!.id;
}

/* ---------- audit ---------- */
export async function listAudit(tx: Tx, ctx: Actor, f: { q?: string; page: number; pageSize: number }) {
  assertCan(ctx, "audit.read", "read the audit log");
  const where = f.q
    ? or(
        ilike(auditLogs.summary, `%${f.q}%`),
        ilike(auditLogs.actorName, `%${f.q}%`),
        ilike(auditLogs.action, `%${f.q}%`),
      )
    : undefined;
  const rows = await tx
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const [c] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);
  return { rows, total: c?.count ?? 0 };
}
