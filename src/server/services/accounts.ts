import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, withOrg } from "../db";
import { authTokens, branches, memberships, organisations, roles, users } from "../db/schema";
import { createDefaultFunds } from "./giving";
import { createDefaultCategories } from "./expenses";
import { grantWelcomeUnits, STARTER_TEMPLATES } from "./messaging";
import { createDefaultScheduleTemplates } from "./schedules";
import { createMemoDefaults } from "./memos";
import { messageTemplates } from "../db/schema";
import { DEFAULT_ROLES } from "../auth/permissions";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { decrypt, encrypt, randomToken, sha256 } from "../crypto";
import { verifyTotp } from "../auth/totp";
import { audit } from "../audit";
import { AppError } from "../errors";
import { slugify } from "@/lib/utils";
import { normalizeNgPhone } from "@/lib/phone";

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export type SignUpInput = {
  churchName: string;
  denomination?: string;
  state?: string;
  name: string;
  email: string;
  phone?: string;
  password: string;
};

async function uniqueSlug(base: string) {
  const root = slugify(base) || "church";
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${root}-${i + 1}` : root;
    const [hit] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, slug))
      .limit(1);
    if (!hit) return slug;
  }
  return `${root}-${randomToken(4).toLowerCase()}`;
}

/** Creates a church with its HQ branch, the default roles, and the signing-up user as Super Admin. */
export async function signUp(input: SignUpInput) {
  const email = input.email.trim().toLowerCase();
  const pwProblem = passwordProblem(input.password, { email });
  if (pwProblem) throw new AppError(pwProblem, { password: pwProblem });
  const phone = input.phone ? normalizeNgPhone(input.phone) : null;
  if (input.phone && !phone)
    throw new AppError("Enter a valid Nigerian phone number.", {
      phone: "Enter a valid Nigerian phone number, e.g. 0803 123 4567.",
    });
  const [existing] = await db
    .select({ id: users.id, hash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing)
    throw new AppError("An account with this email already exists. Sign in instead, or reset your password.", {
      email: "This email already has an account.",
    });

  const slug = await uniqueSlug(input.churchName);
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({
        name: input.churchName.trim(),
        slug,
        denomination: input.denomination || null,
        state: input.state || null,
        email,
        phone,
      })
      .returning();
    const [user] = await tx.insert(users).values({ email, name: input.name.trim(), phone, passwordHash }).returning();
    const roleRows = await tx
      .insert(roles)
      .values(
        DEFAULT_ROLES.map((r) => ({
          orgId: org!.id,
          key: r.key,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          isSystem: true,
        })),
      )
      .returning();
    const owner = roleRows.find((r) => r.key === "owner")!;
    await tx.insert(memberships).values({ orgId: org!.id, userId: user!.id, roleId: owner.id, staffId: "STF-001" });
    // Branch rows are protected by row-level security, so scope this part of the transaction to the new church.
    await tx.execute(sql`select set_config('app.org_id', ${org!.id}, true)`);
    await tx.insert(branches).values({ orgId: org!.id, name: "Headquarters", code: "HQ", path: "hq", level: "hq" });
    await createDefaultFunds(tx, org!.id);
    await createDefaultCategories(tx, org!.id);
    await grantWelcomeUnits(tx, org!.id);
    await createDefaultScheduleTemplates(tx, org!.id);
    await createMemoDefaults(tx, org!.id);
    await tx.insert(messageTemplates).values(STARTER_TEMPLATES.map((t) => ({ ...t, orgId: org!.id })));
    await audit(
      tx,
      { user: { id: user!.id, name: user!.name }, org: { id: org!.id } },
      {
        action: "org.created",
        summary: `Created ${org!.name} and became Super Admin`,
        entityType: "organisation",
        entityId: org!.id,
      },
    );
    return { orgId: org!.id, userId: user!.id, slug };
  });
}

export type SignInResult =
  | { status: "ok"; userId: string; mustChange: boolean }
  | { status: "mfa"; userId: string }
  | { status: "invalid" }
  | { status: "locked"; minutes: number }
  | { status: "expired" };

export async function checkCredentials(emailRaw: string, password: string): Promise<SignInResult> {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) {
    await hashPassword(password); // equalise timing so attackers can't tell which emails exist
    return { status: "invalid" };
  }
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now())
    return { status: "locked", minutes: Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000) };
  const ok = await verifyPassword(u.passwordHash, password);
  if (!ok) {
    const failed = u.failedLogins + 1;
    await db
      .update(users)
      .set({
        failedLogins: failed >= LOCK_AFTER ? 0 : failed,
        lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
      })
      .where(eq(users.id, u.id));
    return failed >= LOCK_AFTER ? { status: "locked", minutes: LOCK_MINUTES } : { status: "invalid" };
  }
  if (u.mustChangePassword && u.tempPasswordExpiresAt && u.tempPasswordExpiresAt.getTime() < Date.now()) return { status: "expired" };
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return u.mfaEnabled ? { status: "mfa", userId: u.id } : { status: "ok", userId: u.id, mustChange: u.mustChangePassword };
}

/** Accepts an authenticator code or a one-time recovery code. */
export async function verifySecondFactor(userId: string, code: string): Promise<boolean> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.mfaEnabled || !u.mfaSecretEnc) return false;
  const secret = decrypt(u.mfaSecretEnc)!;
  if (verifyTotp(secret, code)) return true;
  const h = sha256(code.trim().toUpperCase());
  if (u.mfaRecoveryHashes.includes(h)) {
    await db
      .update(users)
      .set({ mfaRecoveryHashes: u.mfaRecoveryHashes.filter((x) => x !== h) })
      .where(eq(users.id, userId));
    return true;
  }
  return false;
}

export async function enableMfa(userId: string, secret: string, code: string) {
  if (!verifyTotp(secret, code))
    throw new AppError("That code didn't match. Check the time on your phone and try the newest code.", {
      code: "Code didn't match.",
    });
  const recovery = Array.from({ length: 8 }, () =>
    randomToken(6)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "X")
      .slice(0, 8),
  );
  await db
    .update(users)
    .set({ mfaEnabled: true, mfaSecretEnc: encrypt(secret), mfaRecoveryHashes: recovery.map((c) => sha256(c)) })
    .where(eq(users.id, userId));
  return recovery;
}

export async function disableMfa(userId: string) {
  await db
    .update(users)
    .set({ mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] })
    .where(eq(users.id, userId));
}

/** Creates a password-reset token. Always "succeeds" so the form never reveals which emails exist. */
export async function createPasswordReset(
  emailRaw: string,
): Promise<{ token: string; user: { id: string; name: string; email: string } } | null> {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) return null;
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId: u.id,
    email,
    purpose: "password_reset",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60000),
  });
  return { token, user: { id: u.id, name: u.name, email: u.email } };
}

export async function resetPassword(token: string, password: string) {
  const [t] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.purpose, "password_reset"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!t?.userId) throw new AppError("This reset link has expired or was already used. Request a new one.");
  const problem = passwordProblem(password, { email: t.email ?? undefined });
  if (problem) throw new AppError(problem, { password: problem });
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, mustChangePassword: false, tempPasswordExpiresAt: null })
    .where(eq(users.id, t.userId));
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
  return t.userId;
}

/** Staff invitations: creates a token the invitee uses to set a password (or join with an existing account). */
export async function createInvite(
  orgId: string,
  input: { email: string; name: string; roleId: string; branchIds: string[]; title?: string },
  invitedBy: { id: string; name: string },
) {
  const email = input.email.trim().toLowerCase();
  const token = randomToken(32);
  await db.insert(authTokens).values({
    orgId,
    email,
    purpose: "invite",
    tokenHash: sha256(token),
    data: {
      name: input.name,
      roleId: input.roleId,
      branchIds: input.branchIds,
      title: input.title ?? null,
      invitedBy: invitedBy.name,
    },
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  return token;
}

export async function readInvite(token: string) {
  const [t] = await db
    .select({ t: authTokens, org: organisations })
    .from(authTokens)
    .innerJoin(organisations, eq(organisations.id, authTokens.orgId))
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.purpose, "invite"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!t) return null;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, t.t.email!)).limit(1);
  return {
    tokenId: t.t.id,
    orgId: t.org.id,
    orgName: t.org.name,
    email: t.t.email!,
    data: t.t.data as { name: string; roleId: string; branchIds: string[]; title: string | null; invitedBy: string },
    hasAccount: !!existing,
  };
}

export async function acceptInvite(token: string, password: string, name?: string) {
  const inv = await readInvite(token);
  if (!inv)
    throw new AppError("This invitation has expired or was already used. Ask your church admin to send a new one.");
  let [u] = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
  if (u) {
    if (!(await verifyPassword(u.passwordHash, password)))
      throw new AppError("That password doesn't match your existing account.", {
        password: "Wrong password for this email.",
      });
  } else {
    const problem = passwordProblem(password, { email: inv.email });
    if (problem) throw new AppError(problem, { password: problem });
    [u] = await db
      .insert(users)
      .values({ email: inv.email, name: (name || inv.data.name).trim(), passwordHash: await hashPassword(password) })
      .returning();
  }
  await withOrg(inv.orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, inv.orgId), eq(memberships.userId, u!.id)))
      .limit(1);
    if (existing)
      await tx
        .update(memberships)
        .set({ roleId: inv.data.roleId, branchIds: inv.data.branchIds, status: "active", title: inv.data.title })
        .where(eq(memberships.id, existing.id));
    else
      await tx.insert(memberships).values({
        orgId: inv.orgId,
        userId: u!.id,
        roleId: inv.data.roleId,
        branchIds: inv.data.branchIds,
        title: inv.data.title,
      });
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, inv.tokenId));
    await audit(
      tx,
      { user: { id: u!.id, name: u!.name }, org: { id: inv.orgId } },
      {
        action: "user.joined",
        summary: `Accepted an invitation from ${inv.data.invitedBy}`,
        entityType: "user",
        entityId: u!.id,
      },
    );
  });
  return { userId: u!.id, orgId: inv.orgId };
}

/** First sign-in with a temporary password: the user picks their own. */
export async function replaceTemporaryPassword(userId: string, next: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.mustChangePassword) throw new AppError("Your password is already set. Go to your dashboard.");
  if (await verifyPassword(u.passwordHash, next)) throw new AppError("Choose a new password, not the temporary one.", { password: "Use a different password." });
  const problem = passwordProblem(next, { email: u.email });
  if (problem) throw new AppError(problem, { password: problem });
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, tempPasswordExpiresAt: null }).where(eq(users.id, userId));
}
