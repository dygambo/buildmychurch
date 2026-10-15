import nodemailer from "nodemailer";
import { db } from "../db";
import { devMailbox } from "../db/schema";
import { env } from "../env";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};
export type SendResult = { providerId: string | null; accepted: boolean };

/** A failure the provider says is worth retrying (timeouts, 4xx temporary codes, 5xx). */
export class TransientSendError extends Error {}
/** A failure that won't fix itself (bad address, mailbox full, blocked). */
export class PermanentSendError extends Error {}

async function viaResend(m: EmailMessage): Promise<SendResult> {
  const e = env();
  if (!e.RESEND_API_KEY) throw new PermanentSendError("Email isn't set up: RESEND_API_KEY is missing.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: e.EMAIL_FROM,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      reply_to: m.replyTo,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (res.ok) return { providerId: body.id ?? null, accepted: true };
  const msg = `Email provider returned ${res.status}: ${body.message ?? res.statusText}`;
  if (res.status === 429 || res.status >= 500) throw new TransientSendError(msg);
  throw new PermanentSendError(msg);
}

let smtp: nodemailer.Transporter | undefined;
async function viaSmtp(m: EmailMessage): Promise<SendResult> {
  const e = env();
  if (!e.SMTP_URL) throw new PermanentSendError("Email isn't set up: SMTP_URL is missing.");
  smtp ??= nodemailer.createTransport(e.SMTP_URL);
  try {
    const info = await smtp.sendMail({
      from: e.EMAIL_FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
      attachments: m.attachments,
    });
    return { providerId: info.messageId ?? null, accepted: true };
  } catch (err) {
    const code = (err as { responseCode?: number }).responseCode ?? 0;
    const msg = (err as Error).message;
    if (code >= 500 && code < 600) throw new PermanentSendError(msg);
    throw new TransientSendError(msg);
  }
}

async function viaLog(m: EmailMessage): Promise<SendResult> {
  const [row] = await db
    .insert(devMailbox)
    .values({ to: m.to, subject: m.subject, html: m.html, text: m.text ?? null })
    .returning({ id: devMailbox.id });
  return { providerId: `log_${row!.id}`, accepted: true };
}

export async function sendEmail(m: EmailMessage): Promise<SendResult> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) throw new PermanentSendError(`"${m.to}" isn't a valid email address.`);
  switch (env().EMAIL_PROVIDER) {
    case "resend":
      return viaResend(m);
    case "smtp":
      return viaSmtp(m);
    default:
      return viaLog(m);
  }
}
