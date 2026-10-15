"use server";
import { clientIp } from "@/server/request";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import {
  acceptInvite,
  checkCredentials,
  createPasswordReset,
  resetPassword,
  signUp,
  verifySecondFactor,
} from "@/server/services/accounts";
import { createSession, destroyOtherSessions, destroySession, readSession, updateSession } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { zodFieldErrors, type ActionResult } from "@/server/action";
import { emailLayout, p } from "@/server/emails/layout";
import { firstName } from "@/lib/format";
import { env } from "@/server/env";

const ip = clientIp;

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function signInAction(input: z.input<typeof signInSchema>): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const addr = await ip();
  if (
    !(await rateLimit(`signin:ip:${addr}`, 30, 900)) ||
    !(await rateLimit(`signin:email:${parsed.data.email.toLowerCase()}`, 10, 900))
  )
    return { ok: false, error: "Too many sign-in attempts. Wait 15 minutes, then try again." };
  const r = await checkCredentials(parsed.data.email, parsed.data.password);
  if (r.status === "invalid")
    return {
      ok: false,
      error: "That email and password don't match an account.",
      fieldErrors: { password: "Check your password." },
    };
  if (r.status === "locked")
    return {
      ok: false,
      error: `This account is locked after too many failed attempts. Try again in ${r.minutes} minute${r.minutes === 1 ? "" : "s"}, or reset your password.`,
    };
  await createSession(r.userId, { mfaPending: r.status === "mfa" });
  return { ok: true, data: { next: r.status === "mfa" ? "/sign-in/verify" : "/dashboard" } };
}

export async function verifyMfaAction(input: { code: string }): Promise<ActionResult<{ next: string }>> {
  const s = await readSession();
  if (!s?.mfaPending) return { ok: false, error: "Your sign-in has expired. Start again." };
  if (!(await rateLimit(`mfa:${s.userId}`, 8, 900)))
    return { ok: false, error: "Too many attempts. Wait 15 minutes, then try again." };
  const ok = await verifySecondFactor(s.userId, input.code ?? "");
  if (!ok)
    return {
      ok: false,
      error: "That code isn't right. Use the newest code from your authenticator app, or a recovery code.",
      fieldErrors: { code: "Code didn't match." },
    };
  await updateSession({ mfaPending: false });
  return { ok: true, data: { next: "/dashboard" } };
}

const signUpSchema = z.object({
  churchName: z.string().trim().min(3, "Enter your church's name."),
  denomination: z.string().trim().optional(),
  state: z.string().trim().optional(),
  name: z.string().trim().min(3, "Enter your full name."),
  email: z.string().trim().email("Enter a valid email address."),
  phone: z.string().trim().optional(),
  password: z.string(),
  consent: z.literal(true, { error: "You need to accept the terms and the data processing agreement." }),
});

export async function signUpAction(input: z.input<typeof signUpSchema>): Promise<ActionResult<{ next: string }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  // browser tests create many churches from one address; real visitors get 5 an hour
  if (!(await rateLimit(`signup:${await ip()}`, process.env.E2E_TEST_HOOKS === "1" ? 100 : 5, 3600)))
    return { ok: false, error: "Too many sign-ups from this network. Try again in an hour." };
  try {
    const r = await signUp(parsed.data);
    await createSession(r.userId, { orgId: r.orgId });
    return { ok: true, data: { next: "/dashboard?welcome=1" } };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error(e);
    return { ok: false, error: "We couldn't create your account just now. Nothing was saved; try again in a moment." };
  }
}

export async function forgotPasswordAction(input: { email: string }): Promise<ActionResult<null>> {
  const email = String(input.email ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email))
    return { ok: false, error: "Enter a valid email address.", fieldErrors: { email: "Enter a valid email address." } };
  if (!(await rateLimit(`reset:${await ip()}`, 10, 3600)))
    return { ok: false, error: "Too many requests. Try again in an hour." };
  const r = await createPasswordReset(email);
  if (r) {
    const url = `${env().APP_URL}/reset-password/${r.token}`;
    await enqueue(db, "email.send", {
      to: r.user.email,
      subject: "Reset your Build My Church password",
      html: emailLayout({
        heading: "Reset your password",
        bodyHtml:
          p(
            `Hi ${firstName(r.user.name)}, we received a request to reset your password. The link works for one hour.`,
          ) + p("If you didn't ask for this, you can ignore this email; your password won't change."),
        button: { label: "Choose a new password", url },
      }),
    });
  }
  return { ok: true, data: null, message: "If that email has an account, we've sent a reset link. Check your inbox." };
}

export async function resetPasswordAction(input: {
  token: string;
  password: string;
}): Promise<ActionResult<{ next: string }>> {
  try {
    const userId = await resetPassword(input.token, input.password);
    await destroyOtherSessions(userId);
    await createSession(userId);
    return { ok: true, data: { next: "/dashboard" }, message: "Password changed. You're signed in." };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}

export async function acceptInviteAction(input: {
  token: string;
  password: string;
  name?: string;
}): Promise<ActionResult<{ next: string }>> {
  try {
    const r = await acceptInvite(input.token, input.password, input.name);
    await createSession(r.userId, { orgId: r.orgId });
    return { ok: true, data: { next: "/dashboard" } };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}

export async function signOutAction() {
  await destroySession();
  redirect("/sign-in");
}
