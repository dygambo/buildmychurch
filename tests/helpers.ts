import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { memberships, organisations, roles, users } from "@/server/db/schema";
import type { Ctx } from "@/server/auth/context";
import type { Permission } from "@/server/auth/permissions";
import { signUp } from "@/server/services/accounts";

let admin: postgres.Sql | undefined;
export const adminSql = () => (admin ??= postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => {} }));

/** Empties every table (as the owner, so row-level security doesn't get in the way). */
export async function resetDb() {
  const sql = adminSql();
  const rows = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (rows.length)
    await sql.unsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let n = 0;
/** Creates a church with its owner and returns a request context for that owner. */
export async function newChurch(name = `Test Church ${++n}`) {
  const email = `owner${n}_${Date.now()}@example.com`;
  const r = await signUp({ churchName: name, name: "Pastor Test", email, password: "Correct-Horse-Battery-9" });
  return { ...r, email, ctx: await ctxFor(r.userId, r.orgId) };
}

export async function ctxFor(userId: string, orgId: string, roleKey?: string): Promise<Ctx> {
  const [row] = await db
    .select({ m: memberships, r: roles, o: organisations, u: users })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.userId, userId));
  if (!row) throw new Error("no membership");
  let perms = row.r.permissions as Permission[];
  let roleName = row.r.name;
  if (roleKey) {
    const [r] = await db.select().from(roles).where(eq(roles.key, roleKey));
    perms = r!.permissions as Permission[];
    roleName = r!.name;
  }
  const set = new Set(perms);
  return {
    sessionId: "test",
    user: { id: row.u.id, name: row.u.name, email: row.u.email, mfaEnabled: row.u.mfaEnabled },
    org: {
      id: orgId,
      name: row.o.name,
      slug: row.o.slug,
      plan: row.o.plan,
      smsSenderId: row.o.smsSenderId,
      timezone: row.o.timezone,
    },
    membership: {
      id: row.m.id,
      roleId: row.r.id,
      roleKey: roleKey ?? row.r.key,
      roleName,
      title: row.m.title,
      staffId: row.m.staffId,
      phone: row.u.phone,
    },
    branchIds: row.m.branchIds,
    perms: set,
    can: (p) => set.has(p),
  };
}

/** Asserts a database error, looking through Drizzle's wrapper to the Postgres error underneath. */
export async function expectDbError(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    const msg = `${err.message} ${err.cause?.message ?? ""}`;
    if (!re.test(msg)) throw new Error(`Expected error matching ${re}, got: ${msg}`);
    return;
  }
  throw new Error(`Expected an error matching ${re}, but it succeeded`);
}
