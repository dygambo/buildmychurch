import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, jobs, memberships, members, roles, sessions, users } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import { checkCredentials, replaceTemporaryPassword } from "@/server/services/accounts";
import { addTeamMember, addTeamSchema, removeTeamMember, removeTeamSchema, resetTeamPassword, setTeamStatus, teamCandidate, temporaryPassword } from "@/server/services/team";
import { addStaff, ctxFor, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

const roleId = async (orgId: string, key: string) => (await db.select({ id: roles.id }).from(roles).where(and(eq(roles.orgId, orgId), eq(roles.key, key))))[0]!.id;
const tempFrom = async (to: string) => {
  const mail = (await db.select().from(jobs).where(eq(jobs.type, "email.send"))).filter((j) => (j.payload as { to: string }).to === to);
  const html = String((mail.at(-1)?.payload as { html?: string })?.html ?? "");
  return /Temporary password: <b[^>]*>([^<]+)<\/b>/.exec(html)?.[1] ?? null;
};

async function setup() {
  const c = await newChurch("Mercy Chapel");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const mk = (first: string, email?: string) =>
    withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, { branchId: hq!.id, firstName: first, lastName: "Okon", gender: "female", phone: `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`, email } as MemberInput, { allowDuplicate: true }),
    );
  return { c, mk };
}

describe("team accounts from the members directory", () => {
  it("adds a member with a role, emails a temporary password, and forces a new password at first sign-in", async () => {
    const { c, mk } = await setup();
    const m = await mk("Grace", "grace.okon@example.com");
    const info = await withOrg(c.orgId, (tx) => teamCandidate(tx, c.ctx, m.id));
    expect(info).toMatchObject({ email: "grace.okon@example.com", onTeam: false, hasAccount: false });

    const r = await withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: m.id, email: "grace.okon@example.com", roleId: await roleId(c.orgId, "admin"), title: "Church Secretary" })));
    expect(r.newAccount).toBe(true);
    const temp = (await tempFrom("grace.okon@example.com"))!;
    expect(temp).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    const [mm] = await db.select().from(memberships).where(eq(memberships.id, r.membershipId));
    expect(mm!.memberId).toBe(m.id);

    const signIn = await checkCredentials("grace.okon@example.com", temp);
    expect(signIn).toMatchObject({ status: "ok", mustChange: true });
    const [u] = await db.select().from(users).where(eq(users.email, "grace.okon@example.com"));
    await expect(replaceTemporaryPassword(u!.id, temp)).rejects.toThrow(/not the temporary one/);
    await replaceTemporaryPassword(u!.id, "Mercy-Chapel-Secretary-26");
    expect(await checkCredentials("grace.okon@example.com", "Mercy-Chapel-Secretary-26")).toMatchObject({ status: "ok", mustChange: false });
    expect((await withOrg(c.orgId, (tx) => teamCandidate(tx, c.ctx, m.id))).onTeam).toBe(true);
    await expect(withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: m.id, email: "grace.okon@example.com", roleId: await roleId(c.orgId, "worker") })))).rejects.toThrow(/already on your team/);
  });

  it("saves an email onto a member without one, and keeps existing accounts' passwords", async () => {
    const { c, mk } = await setup();
    const noEmail = await mk("Esther");
    await withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: noEmail.id, email: "esther@example.com", roleId: await roleId(c.orgId, "worker") })));
    const [row] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(eq(members.id, noEmail.id)));
    expect(row!.emailHash).toBeTruthy();

    // someone who already has an account from another church
    const other = await newChurch("Other Church");
    const [ou] = await db.select().from(users).where(eq(users.id, other.userId));
    const existing = await mk("Pastor", ou!.email);
    const r = await withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: existing.id, email: ou!.email, roleId: await roleId(c.orgId, "hod") })));
    expect(r.newAccount).toBe(false);
    expect(await tempFrom(ou!.email)).toBeNull();
    // a non-owner can't hand out the Super Admin role
    const admin = await addStaff(c.orgId, "admin");
    const x = await mk("Xavier", "x@example.com");
    await expect(withOrg(c.orgId, async (tx) => addTeamMember(tx, admin.ctx, addTeamSchema.parse({ memberId: x.id, email: "x@example.com", roleId: await roleId(c.orgId, "owner") })))).rejects.toThrow(/Super Admin/);
  });

  it("resets passwords, suspends and restores, and removes with or without the member record", async () => {
    const { c, mk } = await setup();
    const m = await mk("Ruth", "ruth.okon@example.com");
    const { membershipId } = await withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: m.id, email: "ruth.okon@example.com", roleId: await roleId(c.orgId, "followup") })));
    const [u] = await db.select().from(users).where(eq(users.email, "ruth.okon@example.com"));
    await replaceTemporaryPassword(u!.id, "Ruth-Follow-Up-Team-26");
    await db.insert(sessions).values({ id: "s1", userId: u!.id, expiresAt: new Date(Date.now() + 86400000) });

    const reset = await withOrg(c.orgId, (tx) => resetTeamPassword(tx, c.ctx, membershipId));
    expect(reset.mode).toBe("temporary");
    expect(await db.select().from(sessions).where(eq(sessions.userId, u!.id))).toHaveLength(0);
    const temp = (await tempFrom("ruth.okon@example.com"))!;
    expect(await checkCredentials("ruth.okon@example.com", temp)).toMatchObject({ status: "ok", mustChange: true });
    // an expired temporary password stops working
    await db.update(users).set({ tempPasswordExpiresAt: new Date(Date.now() - 1000) }).where(eq(users.id, u!.id));
    expect(await checkCredentials("ruth.okon@example.com", temp)).toMatchObject({ status: "expired" });

    await withOrg(c.orgId, (tx) => setTeamStatus(tx, c.ctx, { membershipId, status: "disabled" }));
    expect((await db.select().from(memberships).where(eq(memberships.id, membershipId)))[0]!.status).toBe("disabled");
    await withOrg(c.orgId, (tx) => setTeamStatus(tx, c.ctx, { membershipId, status: "active" }));

    // you can't act on yourself, and the last Super Admin stays
    const [own] = await db.select().from(memberships).where(eq(memberships.userId, c.userId));
    await expect(withOrg(c.orgId, (tx) => setTeamStatus(tx, c.ctx, { membershipId: own!.id, status: "disabled" }))).rejects.toThrow(/your own/);
    const admin = await addStaff(c.orgId, "admin");
    await expect(withOrg(c.orgId, (tx) => removeTeamMember(tx, admin.ctx, removeTeamSchema.parse({ membershipId: own!.id })))).rejects.toThrow(/Super Admin/);

    // removing keeps the member record by default, and deletes the account if this was their only church
    await withOrg(c.orgId, (tx) => removeTeamMember(tx, c.ctx, removeTeamSchema.parse({ membershipId, reason: "Moved to Abuja" })));
    expect(await db.select().from(users).where(eq(users.id, u!.id))).toHaveLength(0);
    const [still] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(eq(members.id, m.id)));
    expect(still!.deletedAt).toBeNull();

    // removing from the directory too
    const m2 = await mk("Joy", "joy.okon@example.com");
    const r2 = await withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: m2.id, email: "joy.okon@example.com", roleId: await roleId(c.orgId, "worker") })));
    await withOrg(c.orgId, (tx) => removeTeamMember(tx, c.ctx, removeTeamSchema.parse({ membershipId: r2.membershipId, alsoRemoveMember: true })));
    const [gone] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(eq(members.id, m2.id)));
    expect(gone!.deletedAt).not.toBeNull();
  });

  it("sends a reset link instead of a temporary password when the person also works with another church", async () => {
    const { c, mk } = await setup();
    const other = await newChurch("Neighbour Church");
    const [ou] = await db.select().from(users).where(eq(users.id, other.userId));
    const m = await mk("Shared", ou!.email);
    const { membershipId } = await withOrg(c.orgId, async (tx) => addTeamMember(tx, c.ctx, addTeamSchema.parse({ memberId: m.id, email: ou!.email, roleId: await roleId(c.orgId, "worker") })));
    const r = await withOrg(c.orgId, (tx) => resetTeamPassword(tx, c.ctx, membershipId));
    expect(r.mode).toBe("link");
    expect(await checkCredentials(ou!.email, "Correct-Horse-Battery-9")).toMatchObject({ status: "ok" });
    // the context of the other church is untouched
    expect((await ctxFor(other.userId, other.orgId)).org.id).toBe(other.orgId);
    expect(temporaryPassword()).not.toBe(temporaryPassword());
  });
});
