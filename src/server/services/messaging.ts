import { createHmac } from "node:crypto";
import { and, asc, count, desc, eq, exists, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import {
  consents,
  groupMembers,
  memberTags,
  members,
  messageCampaigns,
  messageRefs,
  messageTemplates,
  messages,
  organisations,
  paymentIntents,
  pledgeCampaigns,
  pledges,
  givingTransactions,
  smsLedger,
  smsTopups,
  users,
  type Audience,
  type Channel,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan, systemActor } from "../auth/context";
import { audit } from "../audit";
import { decrypt, encrypt, safeEqual } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { brandEmail } from "./brand";
import { emailLayout, esc } from "../emails/layout";
import { env } from "../env";
import { sendEmail } from "../providers/email";
import {
  PermanentSendError,
  TransientSendError,
  sendSms,
  sendWhatsApp,
  whatsappEnabled,
} from "../providers/messaging";
import { initializePayment, paymentsProvider } from "../providers/payments";
import { MAX_SMS_PAGES, smsInfo } from "@/lib/sms";
import { maskPhone } from "@/lib/phone";
import { naira, todayISO } from "@/lib/format";
import { branchScope } from "./scope";
import { newReference } from "./giving";

/* ================= personalisation ================= */

export const TOKENS = ["first_name", "last_name", "full_name", "title", "church"] as const;

export function render(body: string, v: { firstName?: string | null; lastName?: string | null; title?: string | null; church: string }) {
  const first = v.firstName?.trim() || "friend";
  return body
    .replace(/\{first_name\}/gi, first)
    .replace(/\{last_name\}/gi, v.lastName?.trim() ?? "")
    .replace(/\{full_name\}/gi, [v.title, v.firstName, v.lastName].filter(Boolean).join(" ") || first)
    .replace(/\{title\}/gi, v.title?.trim() ?? "")
    .replace(/\{church\}/gi, v.church)
    .replace(/[ \t]{2,}/g, " ");
}

const maskEmail = (e: string) => {
  const [u, d] = e.split("@");
  return `${u!.slice(0, 1)}•••@${d}`;
};

/** Plain text with blank-line paragraphs → simple email HTML. Links stay as text; nothing the writer types runs. */
function textToHtml(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px">${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/* ================= SMS units ================= */

export async function smsBalance(tx: Tx) {
  const [r] = await tx.select({ n: sql<number>`coalesce(sum(${smsLedger.units}), 0)::int` }).from(smsLedger);
  return Number(r?.n ?? 0);
}

export const WELCOME_UNITS = 50;

export async function grantWelcomeUnits(tx: Tx, orgId: string) {
  await tx.insert(smsLedger).values({ orgId, units: WELCOME_UNITS, kind: "welcome", note: "Welcome units to try SMS" });
}

export async function smsLedgerPage(tx: Tx, ctx: Actor) {
  assertCan(ctx, "messaging.manage", "see the SMS wallet");
  return tx.select().from(smsLedger).orderBy(desc(smsLedger.createdAt), desc(smsLedger.id)).limit(100);
}

export const TOPUP_BUNDLES = [500, 1000, 2500, 5000, 10000, 25000] as const;

export const topupSchema = z.object({
  units: z.coerce.number().int().min(100, "Buy at least 100 units.").max(500_000, "That's more than we can sell at once."),
});

/** Starts buying SMS units through Paystack. The money goes to Build My Church, not to the church's account. */
export async function startTopup(tx: Tx, ctx: Actor, input: z.output<typeof topupSchema>) {
  assertCan(ctx, "messaging.manage", "buy SMS units");
  const amountKobo = input.units * env().SMS_UNIT_PRICE_KOBO;
  const reference = newReference();
  const [t] = await tx
    .insert(smsTopups)
    .values({ orgId: ctx.org.id, units: input.units, amountKobo, reference, createdBy: ctx.user.id, createdByName: ctx.user.name })
    .returning({ id: smsTopups.id });
  await tx.insert(paymentIntents).values({
    reference,
    orgId: ctx.org.id,
    purpose: "sms_topup",
    targetId: t!.id,
    amountKobo,
    email: ctx.user.email,
    provider: paymentsProvider(),
  });
  await audit(tx, ctx, {
    action: "sms.topup_started",
    summary: `Started buying ${input.units.toLocaleString("en-NG")} SMS units for ${naira(amountKobo)}`,
    entityType: "sms_topup",
    entityId: t!.id,
  });
  const { authorizationUrl } = await initializePayment({
    reference,
    amountKobo,
    email: ctx.user.email,
    callbackUrl: `${env().APP_URL}/messages/wallet?ref=${reference}`,
    subaccount: null,
    metadata: { purpose: "sms_topup", org: ctx.org.id, units: input.units },
  });
  return { reference, authorizationUrl };
}

/** Called by the payment settler once Paystack confirms the money arrived. Runs at most once per payment. */
export async function confirmTopup(tx: Tx, orgId: string, topupId: string) {
  const [t] = await tx.select().from(smsTopups).where(eq(smsTopups.id, topupId)).for("update");
  if (!t || t.status === "paid") return;
  await tx.update(smsTopups).set({ status: "paid", paidAt: new Date() }).where(eq(smsTopups.id, t.id));
  await tx.insert(smsLedger).values({
    orgId,
    units: t.units,
    kind: "topup",
    reference: t.reference,
    amountKobo: t.amountKobo,
    note: `Bought ${t.units.toLocaleString("en-NG")} units`,
    createdBy: t.createdBy,
    createdByName: t.createdByName,
  });
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  await audit(tx, systemActor({ id: orgId, name: o!.name }, "Payments", []), {
    action: "sms.topup_paid",
    summary: `Added ${t.units.toLocaleString("en-NG")} SMS units (${naira(t.amountKobo)} paid)`,
    entityType: "sms_topup",
    entityId: t.id,
  });
}

export async function failTopup(tx: Tx, topupId: string) {
  await tx.update(smsTopups).set({ status: "failed" }).where(and(eq(smsTopups.id, topupId), eq(smsTopups.status, "pending")));
}

/* ================= audiences ================= */

export const audienceSchema = z
  .object({
    kind: z.enum(["everyone", "stages", "groups", "tags", "people"]),
    stages: z.array(z.enum(["visitor", "first_timer", "second_timer", "regular", "member"])).max(5).optional(),
    groupIds: z.array(z.string().uuid()).max(100).optional(),
    tagIds: z.array(z.string().uuid()).max(100).optional(),
    memberIds: z.array(z.string().uuid()).max(5000).optional(),
    branchIds: z.array(z.string().uuid()).max(100).optional(),
    gender: z.enum(["male", "female"]).optional(),
  })
  .superRefine((a, c) => {
    const need = { stages: a.stages, groups: a.groupIds, tags: a.tagIds, people: a.memberIds } as Record<string, unknown[] | undefined>;
    if (a.kind !== "everyone" && !need[a.kind]?.length)
      c.addIssue({ code: "custom", path: ["audience"], message: "Choose who should get this message." });
  });

type Recipient = {
  memberId: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string | null;
  to: string | null;
  skip: (typeof messages.$inferInsert)["skipReason"] | null;
};

function audienceWhere(a: Audience): SQL | undefined {
  return and(
    isNull(members.deletedAt),
    eq(members.status, "active"),
    a.branchIds?.length ? inArray(members.branchId, a.branchIds) : undefined,
    a.gender ? eq(members.gender, a.gender) : undefined,
    a.kind === "stages" && a.stages?.length ? inArray(members.stage, a.stages as (typeof members.stage.enumValues)[number][]) : undefined,
    a.kind === "people" && a.memberIds?.length ? inArray(members.id, a.memberIds) : undefined,
    a.kind === "groups" && a.groupIds?.length
      ? exists(
          db
            .select({ x: sql`1` })
            .from(groupMembers)
            .where(and(eq(groupMembers.memberId, members.id), inArray(groupMembers.groupId, a.groupIds))),
        )
      : undefined,
    a.kind === "tags" && a.tagIds?.length
      ? exists(
          db
            .select({ x: sql`1` })
            .from(memberTags)
            .where(and(eq(memberTags.memberId, members.id), inArray(memberTags.tagId, a.tagIds))),
        )
      : undefined,
  );
}

/**
 * Turns an audience into people with an address for the channel, and says why anyone is left out.
 * Broadcasts need consent and respect the DND flag for SMS. Shared phones and emails get one message.
 */
export async function resolveAudience(
  tx: Tx,
  a: Audience,
  channel: Channel,
  opts: { scope?: SQL; requireConsent?: boolean } = {},
): Promise<Recipient[]> {
  const rows = await tx
    .select({
      id: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      title: members.title,
      phoneEnc: members.phoneEnc,
      emailEnc: members.emailEnc,
      consent: members.consentMessaging,
      dnd: members.dnd,
    })
    .from(members)
    .where(and(audienceWhere(a), opts.scope))
    .orderBy(asc(members.lastName), asc(members.firstName))
    .limit(50_000);
  const seen = new Set<string>();
  const requireConsent = opts.requireConsent ?? true;
  return rows.map((r) => {
    const to = channel === "email" ? decrypt(r.emailEnc) : decrypt(r.phoneEnc);
    let skip: Recipient["skip"] = null;
    if (requireConsent && !r.consent) skip = "no_consent";
    else if (!to) skip = "no_contact";
    else if (channel === "sms" && r.dnd && requireConsent) skip = "dnd";
    else if (seen.has(to.toLowerCase())) skip = "duplicate";
    if (!skip && to) seen.add(to.toLowerCase());
    return {
      memberId: r.id,
      name: `${r.firstName} ${r.lastName}`,
      firstName: r.firstName,
      lastName: r.lastName,
      title: r.title,
      to,
      skip,
    };
  });
}

export const SKIP_LABEL: Record<NonNullable<Recipient["skip"]>, string> = {
  no_consent: "Haven't agreed to messages",
  no_contact: "No phone or email on record",
  dnd: "Asked not to get SMS",
  invalid: "Number or address isn't valid",
  no_units: "Not enough SMS units",
  duplicate: "Shares a phone or email with someone else on the list",
  inactive: "No longer active",
};

export async function previewAudience(tx: Tx, ctx: Actor, a: Audience, channel: Channel, body = "") {
  assertCan(ctx, "messaging.send", "send messages");
  const list = await resolveAudience(tx, a, channel, { scope: branchScope(ctx, members.branchId) });
  const reach = list.filter((r) => !r.skip);
  const skipped: Record<string, number> = {};
  for (const r of list) if (r.skip) skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
  const pages = channel === "sms" ? Math.max(1, smsInfo(render(body || " ", { firstName: "Oluwaseun", lastName: "Adebayo-Williams", church: ctx.org.name })).pages) : 0;
  return {
    total: list.length,
    reachable: reach.length,
    skipped,
    sample: reach.slice(0, 6).map((r) => r.name),
    unitsEstimate: channel === "sms" ? reach.length * pages : 0,
    balance: channel === "sms" ? await smsBalance(tx) : null,
  };
}

/* ================= broadcasts ================= */

export const campaignSchema = z
  .object({
    channel: z.enum(["sms", "email", "whatsapp"]),
    name: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => v || null),
    subject: z
      .string()
      .trim()
      .max(150)
      .optional()
      .transform((v) => v || null),
    body: z.string().trim().min(2, "Write the message.").max(5000, "That's too long. Keep it under 5,000 characters."),
    audience: audienceSchema,
    scheduleAt: z
      .string()
      .optional()
      .transform((v) => (v ? new Date(v) : null))
      .refine((d) => !d || !Number.isNaN(d.getTime()), "Choose a valid date and time."),
  })
  .superRefine((v, c) => {
    if (v.channel === "email" && !v.subject) c.addIssue({ code: "custom", path: ["subject"], message: "Add a subject line." });
    if (v.channel === "sms" && smsInfo(v.body).pages > MAX_SMS_PAGES)
      c.addIssue({ code: "custom", path: ["body"], message: `SMS can be up to ${MAX_SMS_PAGES} pages. Shorten the message.` });
    if (v.channel === "whatsapp" && v.body.length > 1000)
      c.addIssue({ code: "custom", path: ["body"], message: "WhatsApp messages can be up to 1,000 characters." });
  });

export async function createCampaign(tx: Tx, ctx: Actor, input: z.output<typeof campaignSchema>) {
  assertCan(ctx, "messaging.send", "send messages");
  if (input.channel === "whatsapp" && !whatsappEnabled())
    throw new AppError("WhatsApp isn't connected for this site yet. Send it by SMS or email instead.");
  const now = new Date();
  if (input.scheduleAt && input.scheduleAt.getTime() < now.getTime() - 60_000)
    throw new AppError("That time has passed.", { scheduleAt: "Choose a time in the future." });
  if (input.scheduleAt && input.scheduleAt.getTime() > now.getTime() + 90 * 86400_000)
    throw new AppError("Messages can be scheduled up to 90 days ahead.", { scheduleAt: "Choose an earlier date." });
  // branch staff can only message their own branches
  const audience: Audience = {
    ...input.audience,
    branchIds: ctx.branchIds.length
      ? (input.audience.branchIds?.filter((b) => ctx.branchIds.includes(b)) ?? []).length
        ? input.audience.branchIds!.filter((b) => ctx.branchIds.includes(b))
        : ctx.branchIds
      : input.audience.branchIds,
  };
  const preview = await previewAudience(tx, ctx, audience, input.channel, input.body);
  if (!preview.reachable) throw new AppError("No one in this audience can get this message. Check the list below.");
  if (input.channel === "sms" && preview.balance !== null && preview.unitsEstimate > preview.balance)
    throw new AppError(
      `This needs about ${preview.unitsEstimate.toLocaleString("en-NG")} SMS units and you have ${preview.balance.toLocaleString("en-NG")}. Buy more units or shorten the message.`,
    );
  const runAt = input.scheduleAt ?? now;
  const generic = (t: string) =>
    t
      .replace(/\{church\}/gi, ctx.org.name)
      .replace(/\{(first_name|full_name)\}/gi, "(name)")
      .replace(/\{(last_name|title)\}\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  const flat = generic(input.body);
  const name = input.name ?? (input.channel === "email" ? generic(input.subject!) : flat.slice(0, 60) + (flat.length > 60 ? "…" : ""));
  const [c] = await tx
    .insert(messageCampaigns)
    .values({
      orgId: ctx.org.id,
      channel: input.channel,
      name,
      subject: input.subject,
      body: input.body,
      waTemplate: input.channel === "whatsapp" ? env().WHATSAPP_TEMPLATE : null,
      audience,
      status: "scheduled",
      scheduledAt: runAt,
      createdBy: ctx.user.id,
      createdByName: ctx.user.name,
    })
    .returning({ id: messageCampaigns.id });
  await enqueue(tx, "messages.prepare", { campaignId: c!.id }, { orgId: ctx.org.id, runAt, dedupeKey: `campaign:${c!.id}` });
  await audit(tx, ctx, {
    action: input.scheduleAt ? "message.scheduled" : "message.sent",
    summary: `${input.scheduleAt ? "Scheduled" : "Sent"} ${CHANNEL_LABEL[input.channel]} "${name}" to ${preview.reachable.toLocaleString("en-NG")} ${preview.reachable === 1 ? "person" : "people"}`,
    entityType: "message_campaign",
    entityId: c!.id,
  });
  return { id: c!.id, reachable: preview.reachable };
}

export const CHANNEL_LABEL: Record<Channel, string> = { sms: "SMS", email: "email", whatsapp: "WhatsApp" };

export async function cancelCampaign(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "messaging.send", "cancel messages");
  const [c] = await tx.select().from(messageCampaigns).where(eq(messageCampaigns.id, id)).for("update");
  if (!c) throw notFound("That message");
  if (c.status !== "scheduled") throw new AppError("Only messages that haven't started sending can be cancelled.");
  await tx.update(messageCampaigns).set({ status: "cancelled" }).where(eq(messageCampaigns.id, id));
  await audit(tx, ctx, { action: "message.cancelled", summary: `Cancelled "${c.name}"`, entityType: "message_campaign", entityId: id });
}

/**
 * Worker step one: works out who gets the message, takes the SMS units, and queues one message per person.
 * Safe to run twice: only a campaign still marked scheduled is prepared.
 */
export async function prepareCampaign(orgId: string, campaignId: string) {
  return withOrg(orgId, async (tx) => {
    const [c] = await tx.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId)).for("update");
    if (!c || c.status !== "scheduled") return;
    const [o] = await tx.select().from(organisations).where(eq(organisations.id, orgId));
    const church = o!.name;
    const transactional = c.kind === "automation" && (c.automationKey === "pledge" || c.automationKey === "welcome");
    const list = await resolveAudience(tx, c.audience, c.channel, { requireConsent: !transactional || c.automationKey === "welcome" });
    const rows: (typeof messages.$inferInsert)[] = list.map((r) => {
      const body = render(c.body, { ...r, church });
      const units = c.channel === "sms" && !r.skip ? smsInfo(body).pages : 0;
      return {
        orgId,
        campaignId: c.id,
        channel: c.channel,
        purpose: c.kind === "automation" ? (c.automationKey ?? "automation") : "broadcast",
        memberId: r.memberId,
        recipientName: r.name,
        toEnc: r.to ? encrypt(r.to) : null,
        toMasked: r.to ? (c.channel === "email" ? maskEmail(r.to) : maskPhone(r.to)) : null,
        subject: c.subject ? render(c.subject, { ...r, church }) : null,
        body,
        status: r.skip ? "skipped" : "queued",
        skipReason: r.skip,
        units,
      };
    });
    const needed = rows.reduce((s, r) => s + (r.units ?? 0), 0);
    if (c.channel === "sms" && needed > 0) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sms_wallet:${orgId}`}))`);
      const balance = await smsBalance(tx);
      if (needed > balance) {
        const reason = `Not sent: it needed ${needed.toLocaleString("en-NG")} SMS units and the church had ${balance.toLocaleString("en-NG")}. Buy more units, then send it again.`;
        await tx
          .update(messageCampaigns)
          .set({ status: "failed", failureReason: reason, finishedAt: new Date(), recipients: rows.length })
          .where(eq(messageCampaigns.id, c.id));
        if (c.createdBy) {
          const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, c.createdBy));
          if (u)
            await enqueue(
              tx,
              "email.send",
              {
                to: u.email,
                subject: `Not sent: ${c.name}`,
                html: await brandEmail(orgId, emailLayout({
                  church,
                  heading: "Your SMS wasn't sent",
                  bodyHtml: textToHtml(reason),
                  button: { label: "Buy SMS units", url: `${env().APP_URL}/messages/wallet` },
                })),
              },
              { orgId, dedupeKey: `campaign-failed:${c.id}` },
            );
        }
        return;
      }
      await tx.insert(smsLedger).values({ orgId, units: -needed, kind: "send", campaignId: c.id, note: c.name, createdBy: c.createdBy, createdByName: c.createdByName });
    }
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const inserted = await tx.insert(messages).values(rows.slice(i, i + 500)).returning({ id: messages.id, status: messages.status });
      ids.push(...inserted.filter((x) => x.status === "queued").map((x) => x.id));
    }
    const skipped = rows.filter((r) => r.status === "skipped").length;
    await tx
      .update(messageCampaigns)
      .set({
        status: ids.length ? "sending" : "sent",
        startedAt: new Date(),
        finishedAt: ids.length ? null : new Date(),
        recipients: rows.length,
        skipped,
        unitsUsed: needed,
      })
      .where(eq(messageCampaigns.id, c.id));
    for (let i = 0; i < ids.length; i += 100)
      await enqueue(tx, "messages.deliver", { ids: ids.slice(i, i + 100) }, { orgId, dedupeKey: `deliver:${c.id}:${i}`, maxAttempts: 6 });
  });
}

/**
 * Worker step two: hands each queued message to the provider. Failures that won't fix themselves are marked
 * failed and their SMS units refunded; temporary ones are retried with the job.
 */
export async function deliverMessages(orgId: string, ids: string[]) {
  const [o] = await withOrg(orgId, (tx) => tx.select().from(organisations).where(eq(organisations.id, orgId)));
  let retry = 0;
  const campaigns = new Set<string>();
  for (const id of ids) {
    const claimed = await withOrg(orgId, async (tx) => {
      const [m] = await tx
        .update(messages)
        .set({ status: "sending", claimedAt: new Date(), attempts: sql`${messages.attempts} + 1` })
        .where(and(eq(messages.id, id), eq(messages.status, "queued")))
        .returning();
      return m;
    });
    if (!claimed) continue;
    if (claimed.campaignId) campaigns.add(claimed.campaignId);
    const to = decrypt(claimed.toEnc);
    try {
      if (!to) throw new PermanentSendError("No address");
      let out: { provider: string; providerId: string | null };
      if (claimed.channel === "sms") {
        out = await sendSms({ to, text: claimed.body, senderId: o!.smsSenderId, route: claimed.purpose === "broadcast" ? "generic" : "dnd" });
      } else if (claimed.channel === "whatsapp") {
        out = await sendWhatsApp({ to, template: env().WHATSAPP_TEMPLATE, params: [claimed.body], preview: claimed.body });
      } else {
        const unsub = claimed.memberId && claimed.purpose !== "receipt" ? `${env().APP_URL}/u/${unsubscribeToken(orgId, claimed.memberId)}` : null;
        const r = await sendEmail({
          to,
          subject: claimed.subject ?? o!.name,
          replyTo: o!.email ?? undefined,
          html: await brandEmail(orgId, emailLayout({
            church: o!.name,
            preheader: claimed.body.slice(0, 120),
            heading: claimed.subject ?? o!.name,
            bodyHtml:
              textToHtml(claimed.body) +
              (unsub
                ? `<p style="margin:20px 0 0;font-size:12px;color:#8792aa">Don't want these messages? <a href="${esc(unsub)}" style="color:#8792aa">Unsubscribe</a>.</p>`
                : ""),
            footer: `${o!.name}${o!.address ? ` · ${o!.address}` : ""}`,
          })),
          text: claimed.body + (unsub ? `\n\nUnsubscribe: ${unsub}` : ""),
        });
        out = { provider: env().EMAIL_PROVIDER, providerId: r.providerId };
      }
      await withOrg(orgId, async (tx) => {
        await tx
          .update(messages)
          .set({ status: "sent", provider: out.provider, providerId: out.providerId, sentAt: new Date(), error: null })
          .where(eq(messages.id, id));
      });
      if (out.providerId)
        await db.insert(messageRefs).values({ providerId: out.providerId, orgId, messageId: id }).onConflictDoNothing();
    } catch (e) {
      const permanent = !(e instanceof TransientSendError) || claimed.attempts >= 4;
      await withOrg(orgId, async (tx) => {
        await tx
          .update(messages)
          .set({ status: permanent ? "failed" : "queued", error: (e as Error).message.slice(0, 500) })
          .where(eq(messages.id, id));
        if (permanent && claimed.units > 0)
          await tx.insert(smsLedger).values({
            orgId,
            units: claimed.units,
            kind: "refund",
            messageId: id,
            campaignId: claimed.campaignId,
            note: `Refund: couldn't send to ${claimed.toMasked ?? "a recipient"}`,
          });
      });
      if (!permanent) retry++;
    }
  }
  for (const cid of campaigns) await finishCampaignIfDone(orgId, cid);
  if (retry) throw new TransientSendError(`${retry} message${retry === 1 ? "" : "s"} will be retried`);
}

async function finishCampaignIfDone(orgId: string, campaignId: string) {
  await withOrg(orgId, async (tx) => {
    const [r] = await tx
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.campaignId, campaignId), inArray(messages.status, ["queued", "sending"])));
    if (Number(r?.n ?? 0) === 0)
      await tx
        .update(messageCampaigns)
        .set({ status: "sent", finishedAt: new Date() })
        .where(and(eq(messageCampaigns.id, campaignId), eq(messageCampaigns.status, "sending")));
  });
}

/** Messages stuck in "sending" (the worker died mid-send) go back in the queue, church by church (RLS). */
export async function requeueStuckMessages() {
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const o of orgs) {
    const ids = await withOrg(o.id, async (tx) => {
      const rows = await tx
        .update(messages)
        .set({ status: "queued" })
        .where(and(eq(messages.status, "sending"), lt(messages.claimedAt, new Date(Date.now() - 15 * 60_000))))
        .returning({ id: messages.id });
      return rows.map((r) => r.id);
    });
    if (ids.length)
      await enqueue(db, "messages.deliver", { ids }, { orgId: o.id, dedupeKey: `requeue:${o.id}:${Date.now()}`, maxAttempts: 6 });
  }
}

/** Delivery report from a provider. Unknown references are ignored. */
export async function applyDeliveryReport(providerId: string, status: "delivered" | "failed", error?: string | null) {
  const [ref] = await db.select().from(messageRefs).where(eq(messageRefs.providerId, providerId));
  if (!ref) return false;
  await withOrg(ref.orgId, (tx) =>
    tx
      .update(messages)
      .set(status === "delivered" ? { status: "delivered", deliveredAt: new Date() } : { status: "failed", error: error ?? "The network couldn't deliver it" })
      .where(and(eq(messages.id, ref.messageId), inArray(messages.status, ["sent", "delivered"]))),
  );
  return true;
}

export async function retryFailed(tx: Tx, ctx: Actor, campaignId: string) {
  assertCan(ctx, "messaging.send", "resend messages");
  const [c] = await tx.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId));
  if (!c) throw notFound("That message");
  const failed = await tx
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, "failed")));
  if (!failed.length) throw new AppError("Nothing failed, so there's nothing to resend.");
  const units = c.channel === "sms" ? failed.reduce((s, m) => s + smsInfo(m.body).pages, 0) : 0;
  if (units) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sms_wallet:${ctx.org.id}`}))`);
    const bal = await smsBalance(tx);
    if (units > bal) throw new AppError(`Resending needs ${units} SMS units and you have ${bal}. Buy more units first.`);
    await tx.insert(smsLedger).values({ orgId: ctx.org.id, units: -units, kind: "send", campaignId, note: `Resend: ${c.name}`, createdBy: ctx.user.id, createdByName: ctx.user.name });
  }
  const ids = failed.map((f) => f.id);
  for (const f of failed)
    await tx
      .update(messages)
      .set({ status: "queued", error: null, attempts: 0, units: c.channel === "sms" ? smsInfo(f.body).pages : 0 })
      .where(eq(messages.id, f.id));
  await tx.update(messageCampaigns).set({ status: "sending", finishedAt: null }).where(eq(messageCampaigns.id, campaignId));
  const stamp = Date.now();
  for (let i = 0; i < ids.length; i += 100)
    await enqueue(tx, "messages.deliver", { ids: ids.slice(i, i + 100) }, { orgId: ctx.org.id, dedupeKey: `redeliver:${campaignId}:${stamp}:${i}`, maxAttempts: 6 });
  await audit(tx, ctx, {
    action: "message.retried",
    summary: `Resent ${ids.length} failed message${ids.length === 1 ? "" : "s"} from "${c.name}"`,
    entityType: "message_campaign",
    entityId: campaignId,
  });
  return ids.length;
}

/* ================= one-off messages (receipts, tests) ================= */

/**
 * Sends one message now, outside a broadcast: a receipt, a check-in code, a test. Messages people expect
 * don't need marketing consent, and SMS goes on the DND route so it arrives.
 */
export async function sendDirect(
  tx: Tx,
  orgId: string,
  m: { channel: Channel; to: string; name?: string | null; memberId?: string | null; subject?: string | null; body: string; purpose: string },
) {
  const units = m.channel === "sms" ? smsInfo(m.body).pages : 0;
  let skip: (typeof messages.$inferInsert)["skipReason"] = null;
  if (units) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sms_wallet:${orgId}`}))`);
    if ((await smsBalance(tx)) < units) skip = "no_units";
  }
  const [row] = await tx
    .insert(messages)
    .values({
      orgId,
      channel: m.channel,
      purpose: m.purpose,
      memberId: m.memberId ?? null,
      recipientName: m.name ?? null,
      toEnc: encrypt(m.to),
      toMasked: m.channel === "email" ? maskEmail(m.to) : maskPhone(m.to),
      subject: m.subject ?? null,
      body: m.body,
      status: skip ? "skipped" : "queued",
      skipReason: skip,
      units: skip ? 0 : units,
    })
    .returning({ id: messages.id });
  if (skip) return { id: row!.id, sent: false as const, reason: skip };
  if (units) await tx.insert(smsLedger).values({ orgId, units: -units, kind: "send", messageId: row!.id, note: m.purpose });
  await enqueue(tx, "messages.deliver", { ids: [row!.id] }, { orgId, dedupeKey: `direct:${row!.id}`, maxAttempts: 6 });
  return { id: row!.id, sent: true as const };
}

export const testSchema = z.object({
  channel: z.enum(["sms", "email", "whatsapp"]),
  subject: z.string().max(150).optional(),
  body: z.string().trim().min(2, "Write the message first.").max(5000),
  to: z.string().trim().max(120).optional(),
});

export async function sendTest(tx: Tx, ctx: Actor, input: z.output<typeof testSchema>) {
  assertCan(ctx, "messaging.send", "send messages");
  const [u] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, ctx.user.id));
  const to = input.channel === "email" ? (input.to || ctx.user.email) : input.to || u?.phone;
  if (!to) throw new AppError("Add your phone number in your account settings to send yourself a test.", { to: "Enter a phone number." });
  const [first, ...rest] = ctx.user.name.replace(/^(Pastor|Pst\.?|Rev\.?|Dr\.?|Mr\.?|Mrs\.?|Bro\.?|Sis\.?)\s+/i, "").split(" ");
  const body = render(input.body, { firstName: first, lastName: rest.join(" "), church: ctx.org.name });
  const r = await sendDirect(tx, ctx.org.id, {
    channel: input.channel,
    to,
    name: ctx.user.name,
    subject: input.subject ? `[Test] ${render(input.subject, { firstName: first, church: ctx.org.name })}` : "[Test]",
    body,
    purpose: "test",
  });
  if (!r.sent) throw new AppError("Not enough SMS units to send a test. Buy units first.");
  return { to: input.channel === "email" ? maskEmail(to) : maskPhone(to) };
}

/* ================= history ================= */

export async function listCampaigns(tx: Tx, ctx: Actor, opts: { status?: string; channel?: string; page?: number } = {}) {
  assertCan(ctx, "messaging.send", "see messages");
  const page = Math.max(1, opts.page ?? 1);
  const where = and(
    opts.channel === "sms" || opts.channel === "email" || opts.channel === "whatsapp" ? eq(messageCampaigns.channel, opts.channel) : undefined,
    opts.status === "scheduled" ? eq(messageCampaigns.status, "scheduled") : opts.status === "automation" ? eq(messageCampaigns.kind, "automation") : undefined,
    sql`${messageCampaigns.kind} <> 'test'`,
  );
  const rows = await tx
    .select({
      c: messageCampaigns,
      sent: sql<number>`(select count(*)::int from messages m where m.campaign_id = message_campaigns.id and m.status in ('sent','delivered'))`,
      delivered: sql<number>`(select count(*)::int from messages m where m.campaign_id = message_campaigns.id and m.status = 'delivered')`,
      failed: sql<number>`(select count(*)::int from messages m where m.campaign_id = message_campaigns.id and m.status = 'failed')`,
    })
    .from(messageCampaigns)
    .where(where)
    .orderBy(desc(sql`coalesce(${messageCampaigns.scheduledAt}, ${messageCampaigns.createdAt})`))
    .limit(25)
    .offset((page - 1) * 25);
  const [t] = await tx.select({ n: count() }).from(messageCampaigns).where(where);
  return { rows: rows.map((r) => ({ ...r.c, sent: r.sent, delivered: r.delivered, failed: r.failed })), total: Number(t?.n ?? 0), page, pageSize: 25 };
}
export type CampaignRow = Awaited<ReturnType<typeof listCampaigns>>["rows"][number];

export async function getCampaign(tx: Tx, ctx: Actor, id: string, opts: { status?: string; page?: number } = {}) {
  assertCan(ctx, "messaging.send", "see messages");
  const [c] = await tx.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));
  if (!c) throw notFound("That message");
  const counts = await tx
    .select({ status: messages.status, n: count() })
    .from(messages)
    .where(eq(messages.campaignId, id))
    .groupBy(messages.status);
  const skips = await tx
    .select({ reason: messages.skipReason, n: count() })
    .from(messages)
    .where(and(eq(messages.campaignId, id), eq(messages.status, "skipped")))
    .groupBy(messages.skipReason);
  const page = Math.max(1, opts.page ?? 1);
  const st = opts.status;
  const filter =
    st === "failed" || st === "skipped" || st === "delivered" || st === "queued"
      ? eq(messages.status, st)
      : st === "sent"
        ? inArray(messages.status, ["sent", "delivered"])
        : undefined;
  const list = await tx
    .select({
      id: messages.id,
      memberId: messages.memberId,
      recipientName: messages.recipientName,
      toMasked: messages.toMasked,
      status: messages.status,
      skipReason: messages.skipReason,
      error: messages.error,
      units: messages.units,
      sentAt: messages.sentAt,
      deliveredAt: messages.deliveredAt,
    })
    .from(messages)
    .where(and(eq(messages.campaignId, id), filter))
    .orderBy(asc(messages.recipientName))
    .limit(50)
    .offset((page - 1) * 50);
  const by = Object.fromEntries(counts.map((x) => [x.status, Number(x.n)])) as Record<string, number>;
  const total = Object.values(by).reduce((s, n) => s + n, 0);
  const [sample] = await tx.select({ body: messages.body, subject: messages.subject }).from(messages).where(eq(messages.campaignId, id)).limit(1);
  return {
    ...c,
    counts: {
      total,
      queued: (by.queued ?? 0) + (by.sending ?? 0),
      sent: (by.sent ?? 0) + (by.delivered ?? 0),
      delivered: by.delivered ?? 0,
      failed: by.failed ?? 0,
      skipped: by.skipped ?? 0,
    },
    skips: skips.map((s) => ({ reason: s.reason!, n: Number(s.n) })),
    sample: sample ?? null,
    list,
    listTotal: st ? (st === "sent" ? (by.sent ?? 0) + (by.delivered ?? 0) : by[st] ?? 0) : total,
    page,
  };
}

export async function memberMessages(tx: Tx, memberId: string) {
  return tx
    .select({
      id: messages.id,
      channel: messages.channel,
      purpose: messages.purpose,
      subject: messages.subject,
      body: messages.body,
      status: messages.status,
      skipReason: messages.skipReason,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.memberId, memberId))
    .orderBy(desc(messages.createdAt))
    .limit(10);
}

export async function messagingStats(tx: Tx) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [r] = await tx
    .select({
      sent: sql<number>`count(*) filter (where ${messages.status} in ('sent','delivered'))::int`,
      delivered: sql<number>`count(*) filter (where ${messages.status} = 'delivered')::int`,
      trackable: sql<number>`count(*) filter (where ${messages.channel} <> 'email' and ${messages.status} in ('sent','delivered','failed'))::int`,
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
      sms: sql<number>`count(*) filter (where ${messages.channel} = 'sms' and ${messages.status} in ('sent','delivered'))::int`,
    })
    .from(messages)
    .where(gte(messages.createdAt, since));
  const [reach] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      consent: sql<number>`count(*) filter (where ${members.consentMessaging})::int`,
    })
    .from(members)
    .where(and(isNull(members.deletedAt), eq(members.status, "active")));
  return {
    sent30: Number(r?.sent ?? 0),
    delivered30: Number(r?.delivered ?? 0),
    /** SMS and WhatsApp messages the networks can report on (email can't). */
    trackable30: Number(r?.trackable ?? 0),
    failed30: Number(r?.failed ?? 0),
    sms30: Number(r?.sms ?? 0),
    members: Number(reach?.total ?? 0),
    consenting: Number(reach?.consent ?? 0),
    balance: await smsBalance(tx),
  };
}

/* ================= templates ================= */

export const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Name the template.").max(80),
  channel: z.enum(["sms", "email", "whatsapp"]),
  subject: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((v) => v || null),
  body: z.string().trim().min(2, "Write the message.").max(5000),
});

export async function listTemplates(tx: Tx) {
  return tx.select().from(messageTemplates).where(isNull(messageTemplates.archivedAt)).orderBy(asc(messageTemplates.name));
}

export async function saveTemplate(tx: Tx, ctx: Actor, input: z.output<typeof templateSchema>) {
  assertCan(ctx, "messaging.manage", "manage templates");
  const values = { name: input.name, channel: input.channel, subject: input.subject, body: input.body };
  let id = input.id;
  if (id) {
    const r = await tx.update(messageTemplates).set(values).where(eq(messageTemplates.id, id)).returning({ id: messageTemplates.id });
    if (!r.length) throw notFound("That template");
  } else {
    const [r] = await tx.insert(messageTemplates).values({ ...values, orgId: ctx.org.id, createdBy: ctx.user.id }).returning({ id: messageTemplates.id });
    id = r!.id;
  }
  await audit(tx, ctx, {
    action: input.id ? "template.updated" : "template.created",
    summary: `${input.id ? "Updated" : "Added"} message template "${input.name}"`,
    entityType: "message_template",
    entityId: id,
  });
  return id;
}

export async function archiveTemplate(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "messaging.manage", "manage templates");
  const [t] = await tx.update(messageTemplates).set({ archivedAt: new Date() }).where(eq(messageTemplates.id, id)).returning();
  if (!t) throw notFound("That template");
  await audit(tx, ctx, { action: "template.archived", summary: `Removed message template "${t.name}"`, entityType: "message_template", entityId: id });
}

export const STARTER_TEMPLATES = [
  {
    name: "Service reminder",
    channel: "sms" as const,
    body: "Hi {first_name}, join us this Sunday at 8am for our celebration service. Come with someone! God bless you. - {church}",
  },
  {
    name: "Midweek service",
    channel: "sms" as const,
    body: "Dear {first_name}, our midweek Bible study holds Wednesday 6pm. We'd love to see you there. - {church}",
  },
  {
    name: "Monthly newsletter",
    channel: "email" as const,
    subject: "What's happening at {church} this month",
    body: "Dear {first_name},\n\nHere's what's coming up this month.\n\n(Write your news here.)\n\nGod bless you,\n{church}",
  },
];

/* ================= automations ================= */

export const AUTOMATIONS = {
  birthday: {
    label: "Birthdays",
    when: "On the morning of each member's birthday",
    channel: "sms" as Channel,
    body: "Happy birthday, {first_name}! The Lord bless you and keep you. Have a wonderful year ahead. With love from {church}.",
  },
  anniversary: {
    label: "Wedding anniversaries",
    when: "On each couple's wedding anniversary",
    channel: "sms" as Channel,
    body: "Happy wedding anniversary, {first_name}! May God keep blessing your home. With love from {church}.",
  },
  welcome: {
    label: "Welcome first-timers",
    when: "The morning after someone first visits",
    channel: "sms" as Channel,
    body: "Hi {first_name}, thank you for worshipping with us at {church}! We'd love to see you again this Sunday. God bless you.",
  },
  pledge: {
    label: "Pledge reminders",
    when: "On the 1st of each month, to anyone with an unpaid pledge",
    channel: "sms" as Channel,
    body: "Dear {first_name}, thank you for your pledge to our church project. This is a gentle reminder of your balance. God bless you. - {church}",
  },
} as const;
export type AutomationKey = keyof typeof AUTOMATIONS;
export type AutomationSetting = { enabled: boolean; channel: Channel; body: string };

export async function automationSettings(tx: Tx, orgId: string): Promise<Record<AutomationKey, AutomationSetting>> {
  const [o] = await tx.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
  const saved = ((o?.settings ?? {}) as { messaging?: { automations?: Partial<Record<AutomationKey, Partial<AutomationSetting>>> } }).messaging?.automations ?? {};
  return Object.fromEntries(
    (Object.keys(AUTOMATIONS) as AutomationKey[]).map((k) => [
      k,
      { enabled: saved[k]?.enabled ?? false, channel: saved[k]?.channel ?? AUTOMATIONS[k].channel, body: saved[k]?.body ?? AUTOMATIONS[k].body },
    ]),
  ) as Record<AutomationKey, AutomationSetting>;
}

export const automationSchema = z.object({
  key: z.enum(["birthday", "anniversary", "welcome", "pledge"]),
  enabled: z.boolean(),
  channel: z.enum(["sms", "email", "whatsapp"]),
  body: z.string().trim().min(5, "Write the message.").max(900),
});

export async function saveAutomation(tx: Tx, ctx: Actor, input: z.output<typeof automationSchema>) {
  assertCan(ctx, "messaging.manage", "change automatic messages");
  if (input.channel === "sms" && smsInfo(input.body).pages > 3)
    throw new AppError("Keep automatic SMS to three pages or fewer.", { body: "Shorten the message." });
  if (input.channel === "whatsapp" && !whatsappEnabled()) throw new AppError("WhatsApp isn't connected for this site yet.");
  const all = await automationSettings(tx, ctx.org.id);
  all[input.key] = { enabled: input.enabled, channel: input.channel, body: input.body };
  await tx
    .update(organisations)
    .set({
      settings: sql`jsonb_set(coalesce(${organisations.settings}, '{}'::jsonb), '{messaging}', coalesce(${organisations.settings}->'messaging', '{}'::jsonb) || ${JSON.stringify({ automations: all })}::jsonb)`,
    })
    .where(eq(organisations.id, ctx.org.id));
  await audit(tx, ctx, {
    action: "automation.saved",
    summary: `${input.enabled ? "Turned on" : "Turned off"} automatic ${AUTOMATIONS[input.key].label.toLowerCase()} messages by ${CHANNEL_LABEL[input.channel]}`,
    entityType: "organisation",
    entityId: ctx.org.id,
  });
}

/** Who each automation is for on a given Lagos date. */
async function automationRecipients(tx: Tx, key: AutomationKey, date: string): Promise<string[]> {
  const [, mm, dd] = date.split("-").map(Number) as [number, number, number];
  if (key === "birthday") {
    const r = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(isNull(members.deletedAt), eq(members.status, "active"), eq(members.dobMonth, mm), eq(members.dobDay, dd)));
    return r.map((x) => x.id);
  }
  if (key === "anniversary") {
    const r = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          isNull(members.deletedAt),
          eq(members.status, "active"),
          eq(members.maritalStatus, "married"),
          sql`extract(month from ${members.anniversary}) = ${mm} and extract(day from ${members.anniversary}) = ${dd}`,
        ),
      );
    return r.map((x) => x.id);
  }
  if (key === "welcome") {
    const start = new Date(`${date}T00:00:00+01:00`);
    const r = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          isNull(members.deletedAt),
          inArray(members.stage, ["first_timer", "visitor"]),
          gte(members.createdAt, new Date(start.getTime() - 86400_000)),
          lt(members.createdAt, start),
        ),
      );
    return r.map((x) => x.id);
  }
  if (dd !== 1) return [];
  const r = await tx
    .select({ memberId: pledges.memberId, amount: pledges.amountKobo, id: pledges.id })
    .from(pledges)
    .innerJoin(pledgeCampaigns, eq(pledgeCampaigns.id, pledges.campaignId))
    .where(and(eq(pledges.status, "open"), eq(pledgeCampaigns.status, "active"), sql`${pledges.memberId} is not null`));
  if (!r.length) return [];
  const paid = await tx
    .select({ pledgeId: givingTransactions.pledgeId, sum: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .where(and(eq(givingTransactions.status, "confirmed"), inArray(givingTransactions.pledgeId, r.map((x) => x.id))))
    .groupBy(givingTransactions.pledgeId);
  return [...new Set(r.filter((p) => Number(paid.find((x) => x.pledgeId === p.id)?.sum ?? 0) < Number(p.amount)).map((p) => p.memberId!))];
}

/** Daily: creates one automatic message per switched-on automation that has people today. */
export async function runAutomations(orgId: string, date = todayISO()) {
  return withOrg(orgId, async (tx) => {
    const settings = await automationSettings(tx, orgId);
    const made: string[] = [];
    for (const key of Object.keys(AUTOMATIONS) as AutomationKey[]) {
      const s = settings[key];
      if (!s.enabled) continue;
      if (s.channel === "whatsapp" && !whatsappEnabled()) continue;
      const ids = await automationRecipients(tx, key, date);
      if (!ids.length) continue;
      const [existing] = await tx
        .select({ id: messageCampaigns.id })
        .from(messageCampaigns)
        .where(and(eq(messageCampaigns.automationKey, key), sql`${messageCampaigns.name} like ${`%· ${date}`}`));
      if (existing) continue;
      const [c] = await tx
        .insert(messageCampaigns)
        .values({
          orgId,
          kind: "automation",
          automationKey: key,
          channel: s.channel,
          name: `${AUTOMATIONS[key].label} · ${date}`,
          subject: s.channel === "email" ? AUTOMATIONS[key].label.replace(/s$/, "") : null,
          body: s.body,
          waTemplate: s.channel === "whatsapp" ? env().WHATSAPP_TEMPLATE : null,
          audience: { kind: "people", memberIds: ids },
          status: "scheduled",
          scheduledAt: new Date(),
          createdByName: "Automatic messages",
        })
        .returning({ id: messageCampaigns.id });
      await enqueue(tx, "messages.prepare", { campaignId: c!.id }, { orgId, dedupeKey: `campaign:${c!.id}` });
      made.push(key);
    }
    return made;
  });
}

/* ================= unsubscribe ================= */

const unsubKey = () => createHmac("sha256", Buffer.from(env().BLIND_INDEX_KEY, "base64")).update("unsubscribe-v1").digest();

export function unsubscribeToken(orgId: string, memberId: string) {
  const payload = `${orgId}.${memberId}`;
  const sig = createHmac("sha256", unsubKey()).update(payload).digest("base64url").slice(0, 22);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function readUnsubscribeToken(token: string): { orgId: string; memberId: string } | null {
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", unsubKey()).update(payload).digest("base64url").slice(0, 22);
  if (!safeEqual(sig, expected)) return null;
  const [orgId, memberId] = payload.split(".");
  if (!orgId || !memberId || !/^[0-9a-f-]{36}$/.test(orgId) || !/^[0-9a-f-]{36}$/.test(memberId)) return null;
  return { orgId, memberId };
}

export async function unsubscribeInfo(token: string) {
  const t = readUnsubscribeToken(token);
  if (!t) return null;
  return withOrg(t.orgId, async (tx) => {
    const [m] = await tx
      .select({ firstName: members.firstName, consent: members.consentMessaging })
      .from(members)
      .where(and(eq(members.id, t.memberId), isNull(members.deletedAt)));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, t.orgId));
    if (!m || !o) return null;
    return { church: o.name, firstName: m.firstName, subscribed: m.consent };
  });
}

/** One click from an email: stops broadcasts to this person and records it as consent withdrawn. */
export async function unsubscribe(token: string) {
  const t = readUnsubscribeToken(token);
  if (!t) throw new AppError("This unsubscribe link isn't valid. Reply to the email and the church will remove you.");
  await withOrg(t.orgId, async (tx) => {
    const [m] = await tx
      .update(members)
      .set({ consentMessaging: false })
      .where(and(eq(members.id, t.memberId), eq(members.consentMessaging, true)))
      .returning({ firstName: members.firstName, lastName: members.lastName });
    if (!m) return;
    await tx.insert(consents).values({ orgId: t.orgId, memberId: t.memberId, purpose: "messaging", granted: false, method: "Unsubscribe link in an email" });
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, t.orgId));
    await audit(tx, systemActor({ id: t.orgId, name: o!.name }, "Unsubscribe link", []), {
      action: "member.unsubscribed",
      summary: `${m.firstName} ${m.lastName} unsubscribed from messages`,
      entityType: "member",
      entityId: t.memberId,
    });
  });
}
