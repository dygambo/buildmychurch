import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db";
import { memberships, organisations, roles, users } from "../db/schema";
import { forbidden } from "../errors";
import { readSession } from "./session";
import type { Permission } from "./permissions";

export type Ctx = {
  sessionId: string;
  user: { id: string; name: string; email: string; mfaEnabled: boolean };
  org: { id: string; name: string; slug: string; plan: string; smsSenderId: string | null; timezone: string };
  membership: {
    id: string;
    roleId: string;
    roleKey: string;
    roleName: string;
    title: string | null;
    staffId: string | null;
    phone: string | null;
  };
  /** Branches this user may see. Empty means every branch. */
  branchIds: string[];
  perms: ReadonlySet<Permission>;
  can: (p: Permission) => boolean;
};

export type Actor = Pick<Ctx, "user" | "org" | "membership" | "perms" | "can" | "branchIds">;

export function makeActor(a: Omit<Actor, "can">): Actor {
  return { ...a, can: (p) => a.perms.has(p) };
}

/** Everything about the signed-in user, their church and their permissions. Cached per request. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const s = await readSession();
  if (!s || s.mfaPending) return null;
  const rows = await db
    .select({ m: memberships, r: roles, o: organisations, u: users })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, s.userId), eq(memberships.status, "active")))
    .orderBy(asc(memberships.createdAt));
  if (!rows.length) return null;
  const row = rows.find((r) => r.o.id === s.orgId) ?? rows[0]!;
  const perms = new Set(row.r.permissions as Permission[]);
  return {
    sessionId: s.id,
    user: { id: row.u.id, name: row.u.name, email: row.u.email, mfaEnabled: row.u.mfaEnabled },
    org: {
      id: row.o.id,
      name: row.o.name,
      slug: row.o.slug,
      plan: row.o.plan,
      smsSenderId: row.o.smsSenderId,
      timezone: row.o.timezone,
    },
    membership: {
      id: row.m.id,
      roleId: row.r.id,
      roleKey: row.r.key,
      roleName: row.r.name,
      title: row.m.title,
      staffId: row.m.staffId,
      phone: row.u.phone,
    },
    branchIds: row.m.branchIds,
    perms,
    can: (p) => perms.has(p),
  };
});

/** For pages: sends signed-out visitors to sign in. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) {
    const s = await readSession();
    redirect(s?.mfaPending ? "/sign-in/verify" : "/sign-in");
  }
  return ctx;
}

export function assertCan(ctx: Pick<Ctx, "can">, p: Permission, what?: string) {
  if (!ctx.can(p)) throw forbidden(what);
}

/** All churches the user belongs to (for the church switcher). */
export async function userOrgs(userId: string) {
  return db
    .select({ id: organisations.id, name: organisations.name, role: roles.name })
    .from(memberships)
    .innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
}

/** Used for records created by the system itself (visitor cards, scheduled jobs), never by a signed-in person. */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export function systemActor(org: { id: string; name: string }, name: string, perms: Permission[]): Actor {
  return makeActor({
    user: { id: SYSTEM_USER_ID, name, email: "", mfaEnabled: false },
    org: { id: org.id, name: org.name, slug: "", plan: "", smsSenderId: null, timezone: "Africa/Lagos" },
    membership: { id: "", roleId: "", roleKey: "system", roleName: name, title: null, staffId: null, phone: null },
    perms: new Set(perms),
    branchIds: [],
  });
}
