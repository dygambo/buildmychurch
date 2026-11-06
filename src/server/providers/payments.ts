import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { paymentIntents } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";

/**
 * Payments. Two providers behind one interface:
 * - "paystack": real payments through Paystack (cards, bank transfer, USSD).
 * - "fake": a built-in checkout page for development and tests. Refused in production unless test hooks are on.
 */

export type VerifyResult = {
  status: "success" | "failed" | "abandoned" | "pending";
  amountKobo: number;
  currency: string;
  feeKobo: number | null;
  channel: string | null;
  paidAt: Date | null;
  providerTxId: string | null;
  message: string | null;
};

export class PaymentsNotConfigured extends AppError {
  constructor(msg = "Online giving isn't set up yet. Ask the church office to finish setting it up.") {
    super(msg, undefined, "payments_not_configured");
  }
}

export function paymentsProvider(): "fake" | "paystack" {
  const e = env();
  if (e.PAYMENTS_PROVIDER === "paystack") return "paystack";
  if (e.NODE_ENV === "production" && process.env.E2E_TEST_HOOKS !== "1" && process.env.ALLOW_FAKE_PAYMENTS !== "1")
    throw new PaymentsNotConfigured(
      "Payments are in test mode, which isn't allowed on a live site. Set PAYMENTS_PROVIDER=paystack.",
    );
  return "fake";
}

/* ---------------- fees ---------------- */

export { grossUp, paystackFee } from "@/lib/fees";
import { paystackFee } from "@/lib/fees";

/* ---------------- Paystack ---------------- */

const PS = "https://api.paystack.co";

async function ps<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = env().PAYSTACK_SECRET_KEY;
  if (!key) throw new PaymentsNotConfigured("PAYSTACK_SECRET_KEY is missing.");
  let res: Response;
  try {
    res = await fetch(PS + path, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new AppError(
      "We couldn't reach Paystack. Check your connection and try again.",
      undefined,
      `paystack_unreachable:${(e as Error).message}`,
    );
  }
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || body.status === false) {
    const msg = body.message ?? res.statusText;
    throw new AppError(`Paystack said: ${msg}`, undefined, `paystack_${res.status}`);
  }
  return body.data as T;
}

export async function initializePayment(o: {
  reference: string;
  amountKobo: number;
  email: string;
  callbackUrl: string;
  subaccount?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string }> {
  if (paymentsProvider() === "fake") {
    return { authorizationUrl: `${env().APP_URL}/pay/${encodeURIComponent(o.reference)}` };
  }
  const data = await ps<{ authorization_url: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: o.email,
      amount: o.amountKobo,
      currency: "NGN",
      reference: o.reference,
      callback_url: o.callbackUrl,
      channels: ["card", "bank_transfer", "ussd", "bank"],
      metadata: JSON.stringify(o.metadata ?? {}),
      ...(o.subaccount ? { subaccount: o.subaccount, bearer: "subaccount" } : {}),
    }),
  });
  return { authorizationUrl: data.authorization_url };
}

/** Asks the provider what really happened. We never trust a redirect or a webhook body on its own. */
export async function verifyPayment(reference: string): Promise<VerifyResult> {
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, reference));
  if (!intent) throw new AppError("We don't have a payment with that reference.");
  if (intent.provider === "fake") {
    if (intent.failureReason)
      return { ...blank(intent.amountKobo), status: "failed", message: intent.failureReason };
    if (intent.providerTxId)
      return {
        status: "success",
        amountKobo: intent.amountKobo,
        currency: "NGN",
        feeKobo: paystackFee(intent.amountKobo),
        channel: intent.gatewayChannel ?? "card",
        paidAt: intent.paidAt ?? new Date(),
        providerTxId: intent.providerTxId,
        message: "Approved",
      };
    return { ...blank(intent.amountKobo), status: "pending" };
  }
  const d = await ps<{
    id: number;
    status: string;
    amount: number;
    currency: string;
    fees: number | null;
    channel: string | null;
    paid_at: string | null;
    gateway_response: string | null;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  const status =
    d.status === "success"
      ? "success"
      : d.status === "failed" || d.status === "reversed"
        ? "failed"
        : d.status === "abandoned"
          ? "abandoned"
          : "pending";
  return {
    status,
    amountKobo: Number(d.amount),
    currency: d.currency,
    feeKobo: d.fees == null ? null : Number(d.fees),
    channel: d.channel,
    paidAt: d.paid_at ? new Date(d.paid_at) : null,
    providerTxId: String(d.id),
    message: d.gateway_response,
  };
}

const blank = (amountKobo: number): VerifyResult => ({
  status: "pending",
  amountKobo,
  currency: "NGN",
  feeKobo: null,
  channel: null,
  paidAt: null,
  providerTxId: null,
  message: null,
});

/** Paystack signs webhooks with HMAC-SHA512 of the raw body, keyed with the secret key. */
export function verifyPaystackSignature(
  rawBody: string,
  signature: string | null,
  key: string | undefined = env().PAYSTACK_SECRET_KEY,
): boolean {
  if (!key || !signature) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------------- settlement accounts (where each church's money goes) ---------------- */

export type Bank = { code: string; name: string };

const FAKE_BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "033", name: "United Bank For Africa" },
  { code: "057", name: "Zenith Bank" },
  { code: "50515", name: "Moniepoint MFB" },
  { code: "999992", name: "OPay" },
];

export async function listBanks(): Promise<Bank[]> {
  if (paymentsProvider() === "fake") return FAKE_BANKS;
  const rows = await ps<{ code: string; name: string; active: boolean }[]>("/bank?country=nigeria&perPage=200");
  return rows.filter((b) => b.active !== false).map((b) => ({ code: b.code, name: b.name }));
}

export async function resolveAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
  if (!/^\d{10}$/.test(accountNumber))
    throw new AppError("Account numbers are 10 digits.", { accountNumber: "Enter the 10-digit account number." });
  if (paymentsProvider() === "fake") return { accountName: "GRACE ASSEMBLY CHURCH (TEST)" };
  const d = await ps<{ account_name: string }>(
    `/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`,
  );
  return { accountName: d.account_name };
}

export async function createSubaccount(o: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  email?: string | null;
}): Promise<{ subaccountCode: string }> {
  if (paymentsProvider() === "fake") return { subaccountCode: `ACCT_test_${o.accountNumber.slice(-4)}` };
  const d = await ps<{ subaccount_code: string }>("/subaccount", {
    method: "POST",
    body: JSON.stringify({
      business_name: o.businessName,
      settlement_bank: o.bankCode,
      account_number: o.accountNumber,
      // the church keeps everything; Build My Church takes nothing from gifts
      percentage_charge: 0,
      primary_contact_email: o.email ?? undefined,
    }),
  });
  return { subaccountCode: d.subaccount_code };
}
