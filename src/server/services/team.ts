import { randomInt } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import { authTokens, memberships, members, roles, sessions, users } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { hashPassword } from "../auth/password";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken, sha256 } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { firstName, fullName } from "@/lib/format";
import { removeMember } from "./members";

const TEMP_DAYS = 7;
// no 0/O, 1/l/I: easy to read out over the phone
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** A temporary password like "Kq7m-Xz4p-T9wd": strong, and easy to type from an email. */
export function temporaryPassword() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${part()}-${part()}-${part()}`;
}

const signInUrl = () => `${env().APP_URL}/sign-in`;

function credentialsBox(email: string, password: string) {
  return `<table role="presentation" style="margin:14px 0;border-collapse:collapse;background:#f4f6fb;border-radius:8px"><tr><td style="padding:12px 16px;font-size:14px;line-height:1.7">
Sign-in page: <a href="${signInUrl()}">${esc(signInUrl())}</a><br>
Email: <b>${esc(email)}</b><br>
Temporary password: <b style="font-family:monospace;font-size:16px;letter-spacing:1px">${esc(password)}</b>
</td></tr></table>`;
}

async function loadMembership(tx: Tx, ctx: Actor, membershipId: string) {
  const [m] = await tx
    .select({ m: memberships, r: roles, u: users })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.orgId, ctx.org.id)));
  if (!m) throw notFound("That team member");
  return m;
}

function guardTarget(ctx: Actor, t: Awaited<ReturnType<typeof loadMembership>>, what: string) {
  if (t.u.id === ctx.user.id) throw new AppError(`You can't ${what} your own account here. Use My account instead.`);
  if (t.r.key === "owner" && ctx.membership.roleKey !== "owner") throw new AppError(`Only a Super Admin can ${what} a Super Admin.`);
}

async function assertNotLastOwner(tx: Tx, ctx: Actor, t: Awaited<ReturnType<typeof loadMembership>>) {
  if (t.r.key !== "owner") return;
  const [n] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.orgId, ctx.org.id), eq(roles.key, "owner"), eq(memberships.status, "active"), ne(memberships.id, t.m.id)));
  if (!n?.n) throw new AppError("Every church needs at least one active Super Admin. Make someone else Super Admin first.");
}

/** The member record behind a team account: the one they were added from, or one with the same email. */
async function linkedMember(tx: Tx, t: { memberId: string | null; email: string }) {
  if (t.memberId) {
    const [m] = await tx.select().from(members).where(and(eq(members.id, t.memberId), isNull(members.deletedAt)));
    if (m) return m;
  }
  const [m] = await tx
    .select()
    .from(members)
    .where(and(eq(members.emailHash, blindIndex(t.email.toLowerCase())!), isNull(members.deletedAt)))
    .limit(1);
  return m ?? null;
}

/* ================= adding someone from the members directory ================= */

/** What the Add dialog shows after picking a member: their email, and whether they're already on the team. */
export async function teamCandidate(tx: Tx, ctx: Actor, memberId: string) {
  assertCan(ctx, "users.manage", "add team members");
  const [m] = await tx.select().from(members).where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!m) throw notFound("That member");
  const email = decrypt(m.emailEnc);
  let onTeam = false;
  let hasAccount = false;
  if (email) {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (u) {
      hasAccount = true;
      const [mm] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, ctx.org.id)));
      onTeam = !!mm;
    }
  }
  const [linked] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.memberId, memberId), eq(memberships.orgId, ctx.org.id)));
  return { name: fullName(m), email, onTeam: onTeam || !!linked, hasAccount };
}

export const addTeamSchema = z.object({
  memberId: z.string().uuid("Choose a member."),
  email: z.string().trim().toLowerCase().email("Enter their email address. Their sign-in details go there."),
  roleId: z.string().uuid("Choose a role."),
  branchIds: z.array(z.string().uuid()).default([]),
  title: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
});

/**
 * Gives a member of the church a team account with a role. New users get a temporary password by email
 * and must choose their own at first sign-in; people who already use Build My Church elsewhere keep theirs.
 */
export async function addTeamMember(tx: Tx, ctx: Actor, input: z.output<typeof addTeamSchema>) {
  assertCan(ctx, "users.manage", "add team members");
  const [m] = await tx.select().from(members).where(and(eq(members.id, input.memberId), isNull(members.deletedAt)));
  if (!m) throw notFound("That member");
  const [role] = await tx.select().from(roles).where(and(eq(roles.id, input.roleId), eq(roles.orgId, ctx.org.id)));
  if (!role) throw new AppError("Choose a role.", { roleId: "Choose a role." });
  if (role.key === "owner" && ctx.membership.roleKey !== "owner") throw new AppError("Only a Super Admin can make someone a Super Admin.");
  const name = fullName(m);

  // keep the directory in step: a member without an email gets the one entered here
  const onFile = decrypt(m.emailEnc);
  if (!onFile) {
    const [clash] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.emailHash, blindIndex(input.email)!), isNull(members.deletedAt), ne(members.id, m.id)))
      .limit(1);
    if (clash) throw new AppError("Another member already uses that email.", { email: "Already used by another member." });
    await tx.update(members).set({ emailEnc: encrypt(input.email), emailHash: blindIndex(input.email) }).where(eq(members.id, m.id));
  }

  let [u] = await tx.select().from(users).where(eq(users.email, input.email));
  let tempPassword: string | null = null;
  if (u) {
    const [already] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, ctx.org.id)));
    if (already) throw new AppError(`${name} is already on your team.`);
  } else {
    tempPassword = temporaryPassword();
    [u] = await tx
      .insert(users)
      .values({
        email: input.email,
        name,
        phone: decrypt(m.phoneEnc),
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + TEMP_DAYS * 86_400_000),
      })
      .returning();
  }
  const [mm] = await tx
    .insert(memberships)
    .values({ orgId: ctx.org.id, userId: u!.id, roleId: role.id, branchIds: input.branchIds, title: input.title, memberId: m.id })
    .returning({ id: memberships.id });

  await enqueue(
    tx,
    "email.send",
    {
      to: input.email,
      subject: `You've been added to the ${ctx.org.name} team`,
      html: emailLayout({
        church: ctx.org.name,
        heading: `Welcome to the ${esc(ctx.org.name)} team`,
        bodyHtml:
          p(`Hi ${esc(firstName(name))}, ${esc(ctx.user.name)} has given you access to ${esc(ctx.org.name)} on Build My Church as <b>${esc(role.name)}</b>${input.title ? ` (${esc(input.title)})` : ""}.`) +
          (tempPassword
            ? p("Sign in with these details:") +
              credentialsBox(input.email, tempPassword) +
              p(`You'll be asked to choose your own password when you first sign in. The temporary password stops working in ${TEMP_DAYS} days.`)
            : p(`You already have a Build My Church account with this email, so sign in with your usual password. ${esc(ctx.org.name)} now appears in your church list.`)) +
          p("If you weren't expecting this, contact the church office."),
        button: { label: "Sign in", url: signInUrl() },
      }),
    },
    { orgId: ctx.org.id },
  );
  await audit(tx, ctx, {
    action: "user.added",
    summary: `Added ${name} (${input.email}) to the team as ${role.name}${tempPassword ? " and emailed a temporary password" : ""}`,
    entityType: "user",
    entityId: u!.id,
  });
  return { membershipId: mm!.id, newAccount: !!tempPassword, name };
}

/* ================= password reset by an admin ================= */

/**
 * Sets a new temporary password and emails it. Someone who also works with another church keeps control
 * of their account: they get a reset link instead, so one church can't take over an account others rely on.
 */
export async function resetTeamPassword(tx: Tx, ctx: Actor, membershipId: string) {
  assertCan(ctx, "users.manage", "reset passwords");
  const t = await loadMembership(tx, ctx, membershipId);
  guardTarget(ctx, t, "reset the password of");
  const [others] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, t.u.id), ne(memberships.orgId, ctx.org.id)));
  if (others?.n) {
    const token = randomToken(32);
    await tx.insert(authTokens).values({ userId: t.u.id, email: t.u.email, purpose: "password_reset", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600_000) });
    await enqueue(
      tx,
      "email.send",
      {
        to: t.u.email,
        subject: `Reset your Build My Church password`,
        html: emailLayout({
          church: ctx.org.name,
          heading: "Choose a new password",
          bodyHtml: p(`Hi ${esc(firstName(t.u.name))}, ${esc(ctx.user.name)} at ${esc(ctx.org.name)} asked for your password to be reset. Use the button to choose a new one. The link works for 24 hours.`),
          button: { label: "Choose a new password", url: `${env().APP_URL}/reset-password/${token}` },
        }),
      },
      { orgId: ctx.org.id },
    );
    await audit(tx, ctx, { action: "user.password_reset_link", summary: `Sent ${t.u.name} a password reset link`, entityType: "user", entityId: t.u.id });
    return { mode: "link" as const, email: t.u.email };
  }
  const temp = temporaryPassword();
  await tx
    .update(users)
    .set({ passwordHash: await hashPassword(temp), mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TEMP_DAYS * 86_400_000), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, t.u.id));
  await tx.delete(sessions).where(eq(sessions.userId, t.u.id));
  await enqueue(
    tx,
    "email.send",
    {
      to: t.u.email,
      subject: `Your ${ctx.org.name} password was reset`,
      html: emailLayout({
        church: ctx.org.name,
        heading: "Your password was reset",
        bodyHtml:
          p(`Hi ${esc(firstName(t.u.name))}, ${esc(ctx.user.name)} reset your password. You've been signed out everywhere. Sign in with:`) +
          credentialsBox(t.u.email, temp) +
          p(`You'll choose your own password right after signing in. The temporary one stops working in ${TEMP_DAYS} days.`) +
          p("If you didn't ask for this, tell the church office."),
        button: { label: "Sign in", url: signInUrl() },
      }),
    },
    { orgId: ctx.org.id },
  );
  await audit(tx, ctx, { action: "user.password_reset", summary: `Reset ${t.u.name}'s password and emailed a temporary one`, entityType: "user", entityId: t.u.id });
  return { mode: "temporary" as const, email: t.u.email };
}

/* ================= suspend, reactivate, remove ================= */

export async function setTeamStatus(tx: Tx, ctx: Actor, input: { membershipId: string; status: "active" | "disabled" }) {
  assertCan(ctx, "users.manage", "suspend team members");
  const t = await loadMembership(tx, ctx, input.membershipId);
  guardTarget(ctx, t, input.status === "disabled" ? "suspend" : "reactivate");
  if (t.m.status === input.status) return;
  if (input.status === "disabled") await assertNotLastOwner(tx, ctx, t);
  await tx.update(memberships).set({ status: input.status }).where(eq(memberships.id, t.m.id));
  await enqueue(
    tx,
    "email.send",
    {
      to: t.u.email,
      subject: input.status === "disabled" ? `Your ${ctx.org.name} access is paused` : `Your ${ctx.org.name} access is back`,
      html: emailLayout({
        church: ctx.org.name,
        heading: input.status === "disabled" ? "Your access is paused" : "Welcome back",
        bodyHtml:
          input.status === "disabled"
            ? p(`Hi ${esc(firstName(t.u.name))}, your access to ${esc(ctx.org.name)} on Build My Church has been paused. Your church membership isn't affected. Contact the church office if you have questions.`)
            : p(`Hi ${esc(firstName(t.u.name))}, your access to ${esc(ctx.org.name)} as ${esc(t.r.name)} is back. Sign in with your usual password.`),
        ...(input.status === "active" ? { button: { label: "Sign in", url: signInUrl() } } : {}),
      }),
    },
    { orgId: ctx.org.id },
  );
  await audit(tx, ctx, {
    action: input.status === "disabled" ? "user.suspended" : "user.reactivated",
    summary: `${input.status === "disabled" ? "Suspended" : "Reactivated"} ${t.u.name}'s access (${t.r.name})`,
    entityType: "user",
    entityId: t.u.id,
  });
}

export const removeTeamSchema = z.object({
  membershipId: z.string().uuid(),
  alsoRemoveMember: z.boolean().default(false),
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

/**
 * Takes someone off the team. Their member record stays in the directory unless the admin asks to remove it too.
 * If this was their only church, the sign-in account is deleted as well.
 */
export async function removeTeamMember(tx: Tx, ctx: Actor, input: z.output<typeof removeTeamSchema>) {
  assertCan(ctx, "users.manage", "remove team members");
  const t = await loadMembership(tx, ctx, input.membershipId);
  guardTarget(ctx, t, "remove");
  await assertNotLastOwner(tx, ctx, t);
  const member = await linkedMember(tx, { memberId: t.m.memberId, email: t.u.email });
  if (input.alsoRemoveMember && !member) throw new AppError(`${t.u.name} isn't in the members directory, so there's no member record to remove. Untick that option.`);
  await tx.delete(memberships).where(eq(memberships.id, t.m.id));
  const [others] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.userId, t.u.id));
  if (!others?.n) await tx.delete(users).where(eq(users.id, t.u.id));
  await audit(tx, ctx, {
    action: "user.removed",
    summary: `Removed ${t.u.name} (${t.u.email}) from the team${input.reason ? `. Reason: ${input.reason}` : ""}`,
    entityType: "user",
    entityId: t.u.id,
  });
  if (input.alsoRemoveMember && member) await removeMember(tx, ctx, member.id, input.reason ?? "Removed with their team account");
  return { name: t.u.name, deletedAccount: !others?.n, removedMember: !!(input.alsoRemoveMember && member) };
}

/** For the team list: which team accounts have a member record (to link to their profile). */
export async function teamMemberLinks(tx: Tx, rows: { membershipId: string; memberId: string | null; email: string }[]) {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const m = await linkedMember(tx, r);
    if (m) out[r.membershipId] = m.id;
  }
  return out;
}
