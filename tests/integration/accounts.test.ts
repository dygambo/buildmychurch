import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, memberships, roles, users } from "@/server/db/schema";
import {
  acceptInvite,
  checkCredentials,
  createPasswordReset,
  enableMfa,
  readInvite,
  resetPassword,
  signUp,
  verifySecondFactor,
} from "@/server/services/accounts";
import { inviteStaff } from "@/server/services/org";
import { newTotpSecret, totp } from "@/server/auth/totp";
import { newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

describe("church sign-up", () => {
  it("creates the church, HQ branch, default roles and a Super Admin", async () => {
    const { orgId, userId } = await newChurch("Grace Assembly Abuja");
    const rs = await db.select().from(roles).where(eq(roles.orgId, orgId));
    expect(rs.map((r) => r.key)).toEqual(
      expect.arrayContaining(["owner", "pastor", "finance", "counter", "children", "worker"]),
    );
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId));
    expect(rs.find((r) => r.id === m!.roleId)!.key).toBe("owner");
    const bs = await withOrg(orgId, (tx) => tx.select().from(branches));
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ code: "HQ", level: "hq", path: "hq" });
  });
  it("refuses a second account for the same email", async () => {
    const { email } = await newChurch();
    await expect(
      signUp({ churchName: "Another", name: "X Y", email, password: "Correct-Horse-Battery-9" }),
    ).rejects.toThrow(/already exists/);
  });
  it("gives each church a unique public slug", async () => {
    const a = await newChurch("Living Word");
    const b = await newChurch("Living Word");
    expect(a.slug).toBe("living-word");
    expect(b.slug).toBe("living-word-2");
  });
});

describe("sign-in", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const { email } = await newChurch();
    expect((await checkCredentials(email, "Correct-Horse-Battery-9")).status).toBe("ok");
    expect((await checkCredentials(email, "wrong-password-123")).status).toBe("invalid");
    expect((await checkCredentials("nobody@example.com", "whatever-123456")).status).toBe("invalid");
  });
  it("locks the account after 5 failures, even for the right password", async () => {
    const { email } = await newChurch();
    for (let i = 0; i < 4; i++) expect((await checkCredentials(email, "nope-nope-nope")).status).toBe("invalid");
    expect((await checkCredentials(email, "nope-nope-nope")).status).toBe("locked");
    expect((await checkCredentials(email, "Correct-Horse-Battery-9")).status).toBe("locked");
  });
  it("requires the second factor once two-step is on, and recovery codes work once", async () => {
    const { email, userId } = await newChurch();
    const secret = newTotpSecret();
    await expect(enableMfa(userId, secret, "000000")).rejects.toThrow(/didn't match/);
    const codes = await enableMfa(userId, secret, totp(secret));
    expect(codes).toHaveLength(8);
    expect((await checkCredentials(email, "Correct-Horse-Battery-9")).status).toBe("mfa");
    expect(await verifySecondFactor(userId, totp(secret))).toBe(true);
    expect(await verifySecondFactor(userId, "123456")).toBe(false);
    expect(await verifySecondFactor(userId, codes[0]!)).toBe(true);
    expect(await verifySecondFactor(userId, codes[0]!)).toBe(false);
  });
});

describe("password reset", () => {
  it("works once and then expires", async () => {
    const { email } = await newChurch();
    const r = await createPasswordReset(email);
    expect(r).not.toBeNull();
    await expect(resetPassword(r!.token, "short")).rejects.toThrow(/10 characters/);
    await resetPassword(r!.token, "A-Brand-New-Secret-7");
    expect((await checkCredentials(email, "A-Brand-New-Secret-7")).status).toBe("ok");
    await expect(resetPassword(r!.token, "Another-Secret-77")).rejects.toThrow(/expired|used/);
  });
  it("doesn't reveal whether an email exists", async () => {
    expect(await createPasswordReset("ghost@example.com")).toBeNull();
  });
});

describe("staff invitations", () => {
  it("invites a new person who then joins with the chosen role and branches", async () => {
    const { ctx, orgId } = await newChurch();
    const finance = (await db.select().from(roles).where(eq(roles.orgId, orgId))).find((r) => r.key === "finance")!;
    const hq = (await withOrg(orgId, (tx) => tx.select().from(branches)))[0]!;
    const url = await withOrg(orgId, (tx) =>
      inviteStaff(tx, ctx, {
        email: "funmi@example.com",
        name: "Funmi Adeyemi",
        roleId: finance.id,
        branchIds: [hq.id],
      }),
    );
    const token = url.split("/invite/")[1]!;
    const inv = await readInvite(token);
    expect(inv).toMatchObject({ email: "funmi@example.com", hasAccount: false });
    const { userId } = await acceptInvite(token, "Kaduna-River-Lamp-42");
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId));
    expect(m).toMatchObject({ roleId: finance.id, branchIds: [hq.id] });
    expect(await readInvite(token)).toBeNull();
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u!.name).toBe("Funmi Adeyemi");
  });
  it("won't invite someone who's already on the team", async () => {
    const { ctx, orgId, email } = await newChurch();
    const r = (await db.select().from(roles).where(eq(roles.orgId, orgId)))[1]!;
    await expect(
      withOrg(orgId, (tx) => inviteStaff(tx, ctx, { email, name: "Me", roleId: r.id, branchIds: [] })),
    ).rejects.toThrow(/already on your team/);
  });
});
