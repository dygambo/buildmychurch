import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { devMailbox } from "../db/schema";
import { env } from "../env";
import { smsSafe } from "@/lib/sms";
import { PermanentSendError, TransientSendError } from "./email";

export { PermanentSendError, TransientSendError };
export type SendOutcome = { provider: string; providerId: string | null };

/* ---------------- SMS ---------------- */

/**
 * Sends one SMS. "dnd" routing reaches numbers on the Do-Not-Disturb register and is used for messages people
 * asked for (receipts, check-in codes); broadcasts go on the cheaper generic route.
 */
export async function sendSms(o: { to: string; text: string; senderId?: string | null; route: "dnd" | "generic" }): Promise<SendOutcome> {
  const e = env();
  const text = smsSafe(o.text);
  if (!/^\+234[789][01]\d{8}$/.test(o.to)) throw new PermanentSendError(`${o.to} isn't a Nigerian mobile number.`);
  if (e.SMS_PROVIDER === "termii") {
    if (!e.TERMII_API_KEY) throw new PermanentSendError("SMS isn't set up: TERMII_API_KEY is missing.");
    let res: Response;
    try {
      res = await fetch(`${e.TERMII_BASE_URL}/api/sms/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: e.TERMII_API_KEY,
          to: o.to.replace("+", ""),
          from: o.senderId || e.TERMII_SENDER_ID || "N-Alert",
          sms: text,
          type: "plain",
          channel: o.route,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new TransientSendError(`Couldn't reach Termii: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string; code?: string };
    if (res.ok && body.message_id) return { provider: "termii", providerId: String(body.message_id) };
    const msg = `Termii returned ${res.status}: ${body.message ?? res.statusText}`;
    if (res.status === 429 || res.status >= 500) throw new TransientSendError(msg);
    throw new PermanentSendError(msg);
  }
  const [row] = await db
    .insert(devMailbox)
    .values({ to: o.to, subject: text.slice(0, 60), html: "", text, channel: "sms" })
    .returning({ id: devMailbox.id });
  return { provider: "log", providerId: `log_${row!.id}` };
}

/** Termii signs delivery reports with HMAC-SHA512 of the raw body. */
export function verifyTermiiSignature(raw: string, signature: string | null, key = env().TERMII_WEBHOOK_SECRET) {
  if (!key || !signature) return false;
  const expected = createHmac("sha512", key).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Maps a provider's delivery status to ours. */
export function termiiStatus(s: string | undefined): "delivered" | "failed" | null {
  const v = (s ?? "").toLowerCase();
  if (v.includes("deliver")) return "delivered";
  if (v.includes("fail") || v.includes("reject") || v.includes("expire") || v.includes("dnd")) return "failed";
  return null;
}

/* ---------------- WhatsApp (Meta Cloud API) ---------------- */

export function whatsappEnabled() {
  return env().WHATSAPP_PROVIDER !== "none";
}

/**
 * Business-initiated WhatsApp messages must use a template Meta has approved. Ours has one body variable
 * that carries the church's message, so any text can go out through it.
 */
export async function sendWhatsApp(o: { to: string; template: string; params: string[]; preview: string }): Promise<SendOutcome> {
  const e = env();
  if (e.WHATSAPP_PROVIDER === "none") throw new PermanentSendError("WhatsApp isn't set up for this site.");
  if (e.WHATSAPP_PROVIDER === "meta") {
    if (!e.WHATSAPP_PHONE_NUMBER_ID || !e.WHATSAPP_ACCESS_TOKEN)
      throw new PermanentSendError("WhatsApp isn't set up: the phone number ID or access token is missing.");
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/v21.0/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: o.to.replace("+", ""),
          type: "template",
          template: {
            name: o.template,
            language: { code: "en" },
            components: [{ type: "body", parameters: o.params.map((text) => ({ type: "text", text })) }],
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new TransientSendError(`Couldn't reach WhatsApp: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (res.ok && body.messages?.[0]?.id) return { provider: "whatsapp", providerId: body.messages[0].id };
    const msg = `WhatsApp returned ${res.status}: ${body.error?.message ?? res.statusText}`;
    if (res.status === 429 || res.status >= 500) throw new TransientSendError(msg);
    throw new PermanentSendError(msg);
  }
  const [row] = await db
    .insert(devMailbox)
    .values({ to: o.to, subject: `WhatsApp: ${o.preview.slice(0, 50)}`, html: "", text: o.preview, channel: "whatsapp" })
    .returning({ id: devMailbox.id });
  return { provider: "log", providerId: `wa_log_${row!.id}` };
}

/** Meta signs webhooks with X-Hub-Signature-256: sha256=<HMAC of the raw body keyed with the app secret>. */
export function verifyMetaSignature(raw: string, header: string | null, secret = env().WHATSAPP_APP_SECRET) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}
