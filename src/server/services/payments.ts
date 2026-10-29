import { and, eq, gt, lt } from "drizzle-orm";
import { db, withOrg, type Tx } from "../db";
import { organisations, paymentEvents, paymentIntents } from "../db/schema";
import { verifyPayment, type VerifyResult } from "../providers/payments";
import { systemActor } from "../auth/context";
import { audit } from "../audit";
import { naira } from "@/lib/format";
import { confirmOnlineGift, failOnlineGift } from "./giving";
import { confirmTopup, failTopup } from "./messaging";
import { confirmRegistration, failRegistration } from "./events";

type Intent = typeof paymentIntents.$inferSelect;
type PurposeHandler = {
  succeeded: (tx: Tx, intent: Intent, r: VerifyResult) => Promise<void>;
  failed: (tx: Tx, intent: Intent) => Promise<void>;
};

const handlers: Record<Intent["purpose"], PurposeHandler | undefined> = {
  gift: {
    succeeded: async (tx, i, r) => {
      await confirmOnlineGift(tx, i.orgId, i.targetId, r);
    },
    failed: async (tx, i) => failOnlineGift(tx, i.targetId),
  },
  event: {
    succeeded: async (tx, i, r) => confirmRegistration(tx, i.orgId, i.targetId, r),
    failed: async (tx, i) => failRegistration(tx, i.targetId),
  },
  sms_topup: {
    succeeded: async (tx, i) => confirmTopup(tx, i.orgId, i.targetId),
    failed: async (tx, i) => failTopup(tx, i.targetId),
  },
};

/** Lets other modules (the SMS wallet) handle their own kind of payment. */
export function registerPaymentPurpose(purpose: Intent["purpose"], h: PurposeHandler) {
  handlers[purpose] = h;
}

export type SettleOutcome = Intent["status"] | "unknown";

/**
 * Checks a payment with the provider and applies the result exactly once.
 * Called from the checkout callback, the webhook and the reconciliation job, in any order.
 */
export async function settlePayment(reference: string, now = new Date()): Promise<SettleOutcome> {
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, reference));
  if (!intent) return "unknown";
  if (intent.status !== "pending") return intent.status;
  const r = await verifyPayment(reference);
  // Paystack says "abandoned" while the checkout is still open; the giver can finish later on the same reference
  const ageHours = (now.getTime() - intent.createdAt.getTime()) / 3600_000;
  if (r.status === "abandoned" && ageHours < 24) r.status = "pending";
  return applyPaymentResult(intent.orgId, reference, r);
}

export async function applyPaymentResult(orgId: string, reference: string, r: VerifyResult): Promise<SettleOutcome> {
  return withOrg(orgId, async (tx) => {
    const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.reference, reference)).for("update");
    if (!i) return "unknown";
    if (i.status !== "pending") return i.status;
    const h = handlers[i.purpose];
    if (r.status === "pending") {
      await tx.update(paymentIntents).set({ lastCheckedAt: new Date() }).where(eq(paymentIntents.reference, reference));
      return "pending";
    }
    if (r.status === "success") {
      if (r.amountKobo !== i.amountKobo || r.currency !== "NGN") {
        // money moved, but not what we asked for: don't count it, flag it for a person to check
        const reason = `Paid ${naira(r.amountKobo)} (${r.currency}) but ${naira(i.amountKobo)} was expected. Check this payment in Paystack before counting it.`;
        await tx
          .update(paymentIntents)
          .set({ status: "failed", failureReason: reason, providerTxId: r.providerTxId, lastCheckedAt: new Date() })
          .where(eq(paymentIntents.reference, reference));
        await h?.failed(tx, i);
        await auditSystem(tx, orgId, "payment.mismatch", `Payment ${reference} needs checking: ${reason}`, reference);
        return "failed";
      }
      await tx
        .update(paymentIntents)
        .set({
          status: "succeeded",
          providerTxId: r.providerTxId,
          gatewayChannel: r.channel,
          feeKobo: r.feeKobo,
          paidAt: r.paidAt ?? new Date(),
          lastCheckedAt: new Date(),
        })
        .where(eq(paymentIntents.reference, reference));
      await h?.succeeded(tx, i, r);
      return "succeeded";
    }
    const status = r.status === "abandoned" ? "abandoned" : "failed";
    await tx
      .update(paymentIntents)
      .set({ status, failureReason: r.message, lastCheckedAt: new Date() })
      .where(eq(paymentIntents.reference, reference));
    await h?.failed(tx, i);
    return status;
  });
}

async function auditSystem(tx: Tx, orgId: string, action: string, summary: string, ref: string) {
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  await audit(tx, systemActor({ id: orgId, name: o!.name }, "Payments", []), {
    action,
    summary,
    entityType: "payment",
    entityId: ref,
  });
}

/** Payments still pending after 5 minutes are re-checked; after 48 hours they are given up as abandoned. */
export async function reconcilePayments(now = new Date()) {
  const due = await db
    .select({ reference: paymentIntents.reference })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.status, "pending"),
        lt(paymentIntents.createdAt, new Date(now.getTime() - 5 * 60_000)),
        gt(paymentIntents.createdAt, new Date(now.getTime() - 48 * 3600_000)),
      ),
    )
    .limit(100);
  let settled = 0;
  for (const d of due) {
    try {
      const out = await settlePayment(d.reference, now);
      if (out !== "pending") settled++;
    } catch (e) {
      console.error("[payments] reconcile", d.reference, e);
    }
  }
  const stale = await db
    .select()
    .from(paymentIntents)
    .where(
      and(eq(paymentIntents.status, "pending"), lt(paymentIntents.createdAt, new Date(now.getTime() - 48 * 3600_000))),
    )
    .limit(200);
  for (const s of stale)
    await applyPaymentResult(s.orgId, s.reference, {
      status: "abandoned",
      amountKobo: s.amountKobo,
      currency: "NGN",
      feeKobo: null,
      channel: null,
      paidAt: null,
      providerTxId: null,
      message: "The giver didn't finish paying within 48 hours.",
    });
  return { checked: due.length, settled, abandoned: stale.length };
}

export async function recordPaymentEvent(e: {
  provider: string;
  event: string | null;
  reference: string | null;
  signatureOk: boolean;
  payload: unknown;
  error?: string | null;
}) {
  await db.insert(paymentEvents).values({
    provider: e.provider,
    event: e.event,
    reference: e.reference,
    signatureOk: e.signatureOk,
    payload: e.payload as never,
    error: e.error ?? null,
  });
}

/** The built-in test checkout records what the "giver" chose, then settles like a real payment. */
export async function fakeCheckout(reference: string, outcome: "pay" | "decline") {
  const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, reference));
  if (!i || i.provider !== "fake") return "unknown" as const;
  if (i.status === "pending")
    await db
      .update(paymentIntents)
      .set(
        outcome === "pay"
          ? { providerTxId: `fake_${Date.now()}`, gatewayChannel: "card", paidAt: new Date() }
          : { failureReason: "Declined by the test card" },
      )
      .where(and(eq(paymentIntents.reference, reference), eq(paymentIntents.status, "pending")));
  return settlePayment(reference);
}

export async function getIntent(reference: string) {
  const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, reference));
  return i ?? null;
}
