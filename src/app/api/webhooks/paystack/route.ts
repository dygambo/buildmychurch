import { verifyPaystackSignature } from "@/server/providers/payments";
import { recordPaymentEvent, settlePayment } from "@/server/services/payments";

/**
 * Paystack webhooks. The signature (HMAC-SHA512 of the raw body with the secret key) is checked before anything
 * else. Even then, the body isn't trusted: settlePayment asks Paystack for the transaction's real status.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"));
  let body: { event?: string; data?: { reference?: string } } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const reference = body?.data?.reference ? String(body.data.reference) : null;
  await recordPaymentEvent({
    provider: "paystack",
    event: body?.event ?? null,
    reference,
    signatureOk: ok,
    payload: ok ? body : null,
    error: ok ? null : "Signature didn't match",
  });
  if (!ok) return new Response("Invalid signature", { status: 401 });
  if (body?.event === "charge.success" && reference) {
    try {
      await settlePayment(reference);
    } catch (e) {
      console.error("[paystack webhook]", reference, e);
      // a non-200 makes Paystack retry later
      return new Response("Couldn't process this yet", { status: 500 });
    }
  }
  return new Response("ok");
}
