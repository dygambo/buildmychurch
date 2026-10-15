"use server";
import { unsubscribe } from "@/server/services/messaging";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg } from "@/server/db";
import { branches, organisations, publicLinks } from "@/server/db/schema";
import { zodFieldErrors, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/request";
import { readCheckinLink, selfCheckIn } from "@/server/services/attendance";
import { createOnlineGift, failOnlineGift, onlineGiftSchema } from "@/server/services/giving";
import { initializePayment, paymentsProvider } from "@/server/providers/payments";
import { fakeCheckout } from "@/server/services/payments";
import { paymentIntents } from "@/server/db/schema";
import { env } from "@/server/env";
import { redirect } from "next/navigation";
import { submitVisitorCard, visitorSchema } from "@/server/services/followup";

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error("[public]", e);
    return { ok: false, error: "Something went wrong on our side. Please try again, or ask an usher." };
  }
}

export async function selfCheckInAction(input: { token: string; phone: string }) {
  return guard(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`selfcheckin:${ip}`, 20, 600)))
      throw new AppError("Too many tries from this phone. Please ask an usher to check you in.");
    const link = await db.transaction((tx) => readCheckinLink(tx, String(input.token)));
    if (!link) throw new AppError("This check-in code has expired. Ask an usher for today's code.");
    return withOrg(link.orgId, (tx) => selfCheckIn(tx, link.targetId!, String(input.phone ?? "")));
  });
}

export async function visitorCardAction(input: { token: string; values: Record<string, unknown> }) {
  return guard(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`visitor:${ip}`, 10, 3600)))
      throw new AppError("Too many cards sent from this phone. Please speak to an usher.");
    const parsed = visitorSchema.safeParse(input.values);
    if (!parsed.success) throw new AppError("Please check the highlighted fields.", zodFieldErrors(parsed.error));
    const [link] = await db
      .select()
      .from(publicLinks)
      .where(
        and(
          eq(publicLinks.token, String(input.token)),
          eq(publicLinks.kind, "visitor_form"),
          isNull(publicLinks.revokedAt),
        ),
      );
    if (!link) throw new AppError("This visitor card link is no longer active. Please ask an usher for a paper card.");
    const [org] = await db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, link.orgId));
    return withOrg(link.orgId, async (tx) => {
      const [hq] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.level, "hq"));
      return submitVisitorCard(tx, org!, link.targetId ?? hq!.id, input.values as z.input<typeof visitorSchema>);
    });
  });
}

/** Starts an online gift and returns the checkout address to send the giver to. */
export async function startGiftAction(input: { slug: string; values: Record<string, unknown> }) {
  return guard(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`give:${ip}`, 20, 3600)))
      throw new AppError("Too many attempts from this phone in the last hour. Please try again later.");
    const parsed = onlineGiftSchema.safeParse(input.values);
    if (!parsed.success) throw new AppError("Please check the highlighted fields.", zodFieldErrors(parsed.error));
    const [org] = await db
      .select({ id: organisations.id, status: organisations.status })
      .from(organisations)
      .where(eq(organisations.slug, String(input.slug)));
    if (!org || org.status === "suspended") throw new AppError("This giving page isn't available.");
    paymentsProvider(); // refuses early if payments aren't set up for a live site
    const gift = await withOrg(org.id, (tx) => createOnlineGift(tx, org.id, parsed.data));
    try {
      const { authorizationUrl } = await initializePayment({
        reference: gift.reference,
        amountKobo: gift.amountKobo,
        email: parsed.data.email,
        callbackUrl: `${env().APP_URL}/give/${input.slug}/thanks`,
        subaccount: gift.subaccount,
        metadata: { purpose: "gift", church: input.slug },
      });
      return { url: authorizationUrl, reference: gift.reference };
    } catch (e) {
      // the checkout never opened: close the pending gift so it doesn't linger
      await db
        .update(paymentIntents)
        .set({ status: "failed", failureReason: (e as Error).message })
        .where(eq(paymentIntents.reference, gift.reference));
      const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, gift.reference));
      if (i) await withOrg(org.id, (tx) => failOnlineGift(tx, i.targetId));
      throw e;
    }
  });
}

/** The built-in test checkout (development and automated tests only). */
export async function fakePayAction(reference: string, outcome: "pay" | "decline") {
  if (paymentsProvider() !== "fake") throw new Error("Test checkout is switched off.");
  const ip = await clientIp();
  if (!(await rateLimit(`fakepay:${ip}`, 60, 600))) throw new Error("Too many attempts.");
  const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, reference));
  if (!i) throw new Error("Unknown payment.");
  await fakeCheckout(reference, outcome);
  if (i.purpose === "sms_topup") redirect(`/messages/wallet?ref=${encodeURIComponent(reference)}`);
  const [o] = await db.select({ slug: organisations.slug }).from(organisations).where(eq(organisations.id, i.orgId));
  redirect(`/give/${o!.slug}/thanks?reference=${encodeURIComponent(reference)}`);
}

/** One-click unsubscribe from an email footer. Confirmed with a button so link scanners can't trigger it. */
export async function unsubscribeAction(token: string) {
  const ip = await clientIp();
  if (!(await rateLimit(`unsub:${ip}`, 30, 3600))) throw new Error("Too many attempts. Try again later.");
  await unsubscribe(token);
  redirect(`/u/${encodeURIComponent(token)}?done=1`);
}
