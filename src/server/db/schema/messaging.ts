import { sql } from "drizzle-orm";
import { bigserial, check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

export const CHANNELS = ["sms", "email", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Who a broadcast goes to. Resolved to people when it sends, so late joiners are included. */
export type Audience = {
  kind: "everyone" | "stages" | "groups" | "tags" | "people";
  stages?: string[];
  groupIds?: string[];
  tagIds?: string[];
  memberIds?: string[];
  branchIds?: string[];
  gender?: "male" | "female";
};

/**
 * A message sent to many people at once: a broadcast someone wrote, or one run of an automation
 * (today's birthdays). Each recipient gets a row in `messages`.
 */
export const messageCampaigns = pgTable(
  "message_campaigns",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind", { enum: ["broadcast", "automation", "test"] }).notNull().default("broadcast"),
    automationKey: text("automation_key"),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    name: text("name").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /** WhatsApp only: the approved template that carries the body. */
    waTemplate: text("wa_template"),
    audience: jsonb("audience").$type<Audience>().notNull(),
    status: text("status", { enum: ["draft", "scheduled", "sending", "sent", "failed", "cancelled"] })
      .notNull()
      .default("draft"),
    scheduledAt: ts("scheduled_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    failureReason: text("failure_reason"),
    recipients: integer("recipients").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    unitsUsed: integer("units_used").notNull().default(0),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("message_campaigns_org_idx").on(t.orgId, t.createdAt)],
);

/** One message to one person. The outbox the sender works through, and the record of what happened. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    orgId: orgId(),
    campaignId: uuid("campaign_id"),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /** What this message is for, e.g. broadcast, receipt, birthday. */
    purpose: text("purpose").notNull().default("broadcast"),
    memberId: uuid("member_id"),
    recipientName: text("recipient_name"),
    toEnc: text("to_enc"),
    /** 0803 •••• 4567 or a•••@gmail.com: enough to recognise, not enough to misuse. */
    toMasked: text("to_masked"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status", { enum: ["queued", "sending", "sent", "delivered", "failed", "skipped"] })
      .notNull()
      .default("queued"),
    skipReason: text("skip_reason", {
      enum: ["no_consent", "no_contact", "dnd", "invalid", "no_units", "duplicate", "inactive"],
    }),
    units: integer("units").notNull().default(0),
    provider: text("provider"),
    providerId: text("provider_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    /** When a worker picked it up; a message "sending" for too long is put back in the queue. */
    claimedAt: ts("claimed_at"),
    sentAt: ts("sent_at"),
    deliveredAt: ts("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_campaign_idx").on(t.campaignId, t.status),
    index("messages_member_idx").on(t.orgId, t.memberId, t.createdAt),
    index("messages_org_date_idx").on(t.orgId, t.createdAt),
  ],
);

/** Delivery reports arrive from SMS and WhatsApp providers without a church; this finds the message. No RLS. */
export const messageRefs = pgTable("message_refs", {
  providerId: text("provider_id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  messageId: uuid("message_id").notNull(),
  createdAt: createdAt(),
});

export const messageTemplates = pgTable("message_templates", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  channel: text("channel", { enum: CHANNELS }).notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts("archived_at"),
});

/**
 * SMS units: bought, given, spent and refunded. Append-only; the balance is the sum.
 * One unit is one SMS page to one phone.
 */
export const smsLedger = pgTable(
  "sms_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: orgId(),
    units: integer("units").notNull(),
    kind: text("kind", { enum: ["welcome", "topup", "send", "refund", "adjust"] }).notNull(),
    campaignId: uuid("campaign_id"),
    messageId: uuid("message_id"),
    reference: text("reference"),
    amountKobo: integer("amount_kobo"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sms_ledger_org_idx").on(t.orgId, t.createdAt),
    check("sms_ledger_units_ck", sql`${t.units} <> 0`),
  ],
);

/** SMS unit purchases started through Paystack, settled through payment_intents. */
export const smsTopups = pgTable("sms_topups", {
  id: id(),
  orgId: orgId(),
  units: integer("units").notNull(),
  amountKobo: integer("amount_kobo").notNull(),
  reference: text("reference").notNull(),
  status: text("status", { enum: ["pending", "paid", "failed"] })
    .notNull()
    .default("pending"),
  createdBy: uuid("created_by"),
  createdByName: text("created_by_name"),
  createdAt: createdAt(),
  paidAt: ts("paid_at"),
});

