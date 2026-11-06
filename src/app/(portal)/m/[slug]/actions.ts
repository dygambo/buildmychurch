"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { zodFieldErrors, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/request";
import {
  addMyPrayer,
  identifySchema,
  portalChurch,
  portalMember,
  portalPrayerSchema,
  profileSchema,
  requestCode,
  signOutMember,
  updatePortalProfile,
  verifyCode,
  verifySchema,
} from "@/server/services/portal";

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error("[portal]", e);
    return { ok: false, error: "Something went wrong on our side. Try again in a moment." };
  }
}

async function church(slug: string) {
  const c = await portalChurch(String(slug));
  if (!c) throw new AppError("This member page link isn't valid. Ask the church for the right one.");
  return c;
}

async function signedIn(slug: string) {
  const c = await church(slug);
  const m = await portalMember(c);
  if (!m) throw new AppError("Your session has ended. Sign in again.");
  return { c, m };
}

export async function requestCodeAction(slug: string, input: Record<string, unknown>) {
  return guard(async () => {
    const ip = await clientIp();
    const parsed = identifySchema.safeParse(input);
    if (!parsed.success) throw new AppError("Enter your phone number or email.", zodFieldErrors(parsed.error));
    if (!(await rateLimit(`portal-code:${ip}`, 8, 3600)) || !(await rateLimit(`portal-code-id:${parsed.data.identifier.toLowerCase()}`, 4, 900)))
      throw new AppError("Too many codes requested. Wait 15 minutes and try again.");
    return requestCode(await church(slug), parsed.data.identifier);
  });
}

export async function verifyCodeAction(slug: string, input: Record<string, unknown>) {
  const r = await guard(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`portal-verify:${ip}`, 20, 900))) throw new AppError("Too many tries. Wait 15 minutes and ask for a new code.");
    const parsed = verifySchema.safeParse(input);
    if (!parsed.success) throw new AppError("Enter the 6-digit code.", zodFieldErrors(parsed.error));
    await verifyCode(await church(slug), parsed.data.identifier, parsed.data.code);
    return null;
  });
  if (r.ok) redirect(`/m/${slug}`);
  return r;
}

export async function signOutAction(slug: string) {
  const c = await church(slug);
  await signOutMember(c);
  redirect(`/m/${slug}/sign-in`);
}

export async function updateProfileAction(slug: string, input: Record<string, unknown>) {
  return guard(async () => {
    const { c, m } = await signedIn(slug);
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Please check the highlighted fields.", zodFieldErrors(parsed.error));
    await updatePortalProfile(c, m, parsed.data);
    revalidatePath(`/m/${slug}/profile`);
    return null;
  });
}

export async function addPrayerAction(slug: string, input: Record<string, unknown>) {
  return guard(async () => {
    const { c, m } = await signedIn(slug);
    if (!(await rateLimit(`portal-prayer:${m.id}`, 10, 3600))) throw new AppError("You've sent several requests in the last hour. Try again later.");
    const parsed = portalPrayerSchema.safeParse(input);
    if (!parsed.success) throw new AppError("Please check the highlighted fields.", zodFieldErrors(parsed.error));
    await addMyPrayer(c, m, parsed.data);
    revalidatePath(`/m/${slug}/prayer`);
    return null;
  });
}
