import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

/** Money is always integer kobo. bigint in "number" mode is exact up to ₦90 trillion. */
const kobo = (name: string) => bigint(name, { mode: "number" });

/* ---------------- funds (giving categories) ---------------- */

/**
 * Where money is given to: Tithe, Offering, Building Fund… Restricted funds (a building project, welfare)
 * may only be spent on their purpose, so reports keep them apart.
 */
export const givingFunds = pgTable(
  "giving_funds",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    restricted: boolean("restricted").notNull().default(false),
    /** Shown as a choice on the public giving page. */
    online: boolean("online").notNull().default(true),
    color: text("color").notNull().default("c1"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("giving_funds_org_code_uq").on(t.orgId, t.code)],
);

export const GIVING_CHANNELS = ["cash", "pos", "transfer", "cheque", "online", "other"] as const;
export const BATCH_CHANNELS = ["cash", "pos", "transfer", "cheque", "other"] as const;

/* ---------------- the giving ledger ---------------- */

/**
 * One row per gift. Confirmed rows can't be changed or deleted (a database trigger enforces this);
 * mistakes are corrected with a reversal: a new row for the negative amount that points at the original.
 */
export const givingTransactions = pgTable(
  "giving_transactions",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    fundId: uuid("fund_id").notNull(),
    memberId: uuid("member_id"),
    /** For gifts from people without a member record (online givers, named envelopes). */
    donorName: text("donor_name"),
    donorEmailEnc: text("donor_email_enc"),
    donorPhoneEnc: text("donor_phone_enc"),
    anonymous: boolean("anonymous").notNull().default(false),
    amountKobo: kobo("amount_kobo").notNull(),
    feeKobo: kobo("fee_kobo").notNull().default(0),
    channel: text("channel", { enum: GIVING_CHANNELS }).notNull(),
    /** Card, bank transfer or USSD, as reported by the payment provider. */
    gatewayChannel: text("gateway_channel"),
    source: text("source", { enum: ["batch", "online", "reversal"] }).notNull(),
    status: text("status", { enum: ["pending", "confirmed", "failed"] })
      .notNull()
      .default("confirmed"),
    givenOn: date("given_on").notNull(),
    batchId: uuid("batch_id"),
    serviceId: uuid("service_id"),
    /** The project a gift went to (with or without a pledge). */
    campaignId: uuid("campaign_id"),
    pledgeId: uuid("pledge_id"),
    reference: text("reference").notNull(),
    gatewayRef: text("gateway_ref"),
    receiptNo: text("receipt_no"),
    receiptSentAt: ts("receipt_sent_at"),
    reversalOf: uuid("reversal_of"),
    reversedAt: ts("reversed_at"),
    reversedBy: uuid("reversed_by"),
    note: text("note"),
    createdBy: uuid("created_by"),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("giving_tx_org_date_idx").on(t.orgId, t.givenOn),
    index("giving_tx_org_fund_idx").on(t.orgId, t.fundId, t.givenOn),
    index("giving_tx_member_idx").on(t.orgId, t.memberId),
    index("giving_tx_batch_idx").on(t.batchId),
    index("giving_tx_campaign_idx").on(t.orgId, t.campaignId),
    uniqueIndex("giving_tx_org_ref_uq").on(t.orgId, t.reference),
    uniqueIndex("giving_tx_org_receipt_uq").on(t.orgId, t.receiptNo),
    // a gift can be reversed once, and only once
    uniqueIndex("giving_tx_reversal_uq").on(t.reversalOf),
    check(
      "giving_tx_sign_ck",
      sql`(${t.reversalOf} is null and ${t.amountKobo} > 0) or (${t.reversalOf} is not null and ${t.amountKobo} < 0)`,
    ),
  ],
);

/* ---------------- offline collections, counted by one person and verified by another ---------------- */

export const givingBatches = pgTable(
  "giving_batches",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    batchNo: text("batch_no").notNull(),
    kind: text("kind", { enum: ["service", "transfers", "other"] })
      .notNull()
      .default("service"),
    serviceId: uuid("service_id"),
    label: text("label").notNull(),
    givenOn: date("given_on").notNull(),
    status: text("status", { enum: ["draft", "submitted", "verified", "rejected"] })
      .notNull()
      .default("draft"),
    /** Notes and coins counted, by denomination in naira: { "1000": 120, "500": 41 }. */
    cashCount: jsonb("cash_count").$type<Record<string, number>>(),
    notes: text("notes"),
    totalKobo: kobo("total_kobo").notNull().default(0),
    countedBy: uuid("counted_by").notNull(),
    countedByName: text("counted_by_name").notNull(),
    submittedAt: ts("submitted_at"),
    verifiedBy: uuid("verified_by"),
    verifiedByName: text("verified_by_name"),
    verifiedAt: ts("verified_at"),
    rejectionNote: text("rejection_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("giving_batches_org_no_uq").on(t.orgId, t.batchNo),
    index("giving_batches_org_status_idx").on(t.orgId, t.status),
    // the two-person rule, enforced by the database as well as the app
    check("giving_batches_two_person_ck", sql`${t.verifiedBy} is null or ${t.verifiedBy} <> ${t.countedBy}`),
  ],
);

export const givingBatchLines = pgTable(
  "giving_batch_lines",
  {
    id: id(),
    orgId: orgId(),
    batchId: uuid("batch_id").notNull(),
    fundId: uuid("fund_id").notNull(),
    channel: text("channel", { enum: BATCH_CHANNELS }).notNull(),
    amountKobo: kobo("amount_kobo").notNull(),
    /** A named envelope or transfer: links the gift to a member's giving record. */
    memberId: uuid("member_id"),
    donorName: text("donor_name"),
    campaignId: uuid("campaign_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("giving_batch_lines_batch_idx").on(t.batchId),
    check("giving_batch_lines_amount_ck", sql`${t.amountKobo} > 0`),
  ],
);

/* ---------------- pledges for projects ---------------- */

export const pledgeCampaigns = pgTable("pledge_campaigns", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  description: text("description"),
  fundId: uuid("fund_id").notNull(),
  goalKobo: kobo("goal_kobo").notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  status: text("status", { enum: ["active", "closed"] })
    .notNull()
    .default("active"),
  showOnline: boolean("show_online").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pledges = pgTable(
  "pledges",
  {
    id: id(),
    orgId: orgId(),
    campaignId: uuid("campaign_id").notNull(),
    memberId: uuid("member_id"),
    pledgerName: text("pledger_name").notNull(),
    amountKobo: kobo("amount_kobo").notNull(),
    dueOn: date("due_on"),
    status: text("status", { enum: ["open", "fulfilled", "cancelled"] })
      .notNull()
      .default("open"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pledges_campaign_idx").on(t.orgId, t.campaignId),
    index("pledges_member_idx").on(t.orgId, t.memberId),
    check("pledges_amount_ck", sql`${t.amountKobo} > 0`),
  ],
);

/* ---------------- online payments (no row-level security: webhooks arrive before we know the church) ---------------- */

/**
 * Every online payment we start. The reference is what Paystack sends back in callbacks and webhooks;
 * it tells us which church and record the payment belongs to.
 */
export const paymentIntents = pgTable(
  "payment_intents",
  {
    reference: text("reference").primaryKey(),
    orgId: orgId(),
    purpose: text("purpose", { enum: ["gift", "sms_topup"] }).notNull(),
    targetId: uuid("target_id").notNull(),
    amountKobo: kobo("amount_kobo").notNull(),
    email: text("email").notNull(),
    provider: text("provider", { enum: ["fake", "paystack"] }).notNull(),
    status: text("status", { enum: ["pending", "succeeded", "failed", "abandoned"] })
      .notNull()
      .default("pending"),
    providerTxId: text("provider_tx_id"),
    gatewayChannel: text("gateway_channel"),
    feeKobo: kobo("fee_kobo"),
    paidAt: ts("paid_at"),
    failureReason: text("failure_reason"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_intents_status_idx").on(t.status, t.createdAt)],
);

/** Raw webhook calls, kept for audit and troubleshooting. Signature failures are recorded too. */
export const paymentEvents = pgTable("payment_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  provider: text("provider").notNull(),
  event: text("event"),
  reference: text("reference"),
  signatureOk: boolean("signature_ok").notNull(),
  payload: jsonb("payload"),
  error: text("error"),
  receivedAt: createdAt(),
});
