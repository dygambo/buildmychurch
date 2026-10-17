import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

const kobo = (name: string) => bigint(name, { mode: "number" });

export const MEMO_CATEGORIES = ["requisition", "welfare", "event", "maintenance", "guest", "general"] as const;

/** Standard forms for common requests. */
export const memoTemplates = pgTable("memo_templates", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  category: text("category", { enum: MEMO_CATEGORIES }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  needsAmount: boolean("needs_amount").notNull().default(false),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

/**
 * The approval path. Each step is a role (or one person). A step with a minimum amount only applies to memos
 * asking for at least that much: ₦50,000 might need the administrator; ₦500,000 also the senior pastor.
 */
export const memoRouteSteps = pgTable("memo_route_steps", {
  id: id(),
  orgId: orgId(),
  position: integer("position").notNull(),
  label: text("label").notNull(),
  roleKey: text("role_key"),
  userId: uuid("user_id"),
  minAmountKobo: kobo("min_amount_kobo").notNull().default(0),
  createdAt: createdAt(),
});

export const memos = pgTable(
  "memos",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    refNo: text("ref_no"),
    templateId: uuid("template_id"),
    category: text("category", { enum: MEMO_CATEGORIES }).notNull().default("general"),
    title: text("title").notNull(),
    /** Encrypted: memos can carry medical, welfare and disciplinary details. */
    bodyEnc: text("body_enc").notNull(),
    amountKobo: kobo("amount_kobo"),
    departmentId: uuid("department_id"),
    /** A member the memo is about (a welfare case, say). */
    memberId: uuid("member_id"),
    urgent: boolean("urgent").notNull().default(false),
    /** Only the people on its approval path (and those allowed to open confidential memos) can see it. */
    confidential: boolean("confidential").notNull().default(false),
    status: text("status", { enum: ["draft", "pending", "query", "approved", "declined", "withdrawn"] })
      .notNull()
      .default("draft"),
    currentStep: integer("current_step"),
    initiatorId: uuid("initiator_id").notNull(),
    initiatorName: text("initiator_name").notNull(),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    disbursedAt: ts("disbursed_at"),
    disbursedBy: uuid("disbursed_by"),
    disbursedByName: text("disbursed_by_name"),
    disbursedKobo: kobo("disbursed_kobo"),
    disbursementRef: text("disbursement_ref"),
    expenseId: uuid("expense_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memos_org_ref_uq").on(t.orgId, t.refNo),
    index("memos_org_status_idx").on(t.orgId, t.status),
    index("memos_initiator_idx").on(t.orgId, t.initiatorId),
    check("memos_amount_ck", sql`${t.amountKobo} is null or ${t.amountKobo} > 0`),
  ],
);

export type MemoStamp = { name: string; label: string; at: string; code: string };

/** One step of one memo's approval path, copied from the route when the memo was submitted. */
export const memoSteps = pgTable(
  "memo_steps",
  {
    id: id(),
    orgId: orgId(),
    memoId: uuid("memo_id").notNull(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    roleKey: text("role_key"),
    userId: uuid("user_id"),
    status: text("status", { enum: ["waiting", "current", "approved", "declined", "queried", "skipped"] })
      .notNull()
      .default("waiting"),
    /** First time someone on this step opened the memo: shown as "under review". */
    openedAt: ts("opened_at"),
    actedBy: uuid("acted_by"),
    actedByName: text("acted_by_name"),
    actedAt: ts("acted_at"),
    comment: text("comment"),
    stamp: jsonb("stamp").$type<MemoStamp>(),
  },
  (t) => [uniqueIndex("memo_steps_uq").on(t.memoId, t.position)],
);

/** The conversation on a memo: comments, queries and answers, and what each step did. */
export const memoComments = pgTable(
  "memo_comments",
  {
    id: id(),
    orgId: orgId(),
    memoId: uuid("memo_id").notNull(),
    authorId: uuid("author_id"),
    authorName: text("author_name").notNull(),
    kind: text("kind", { enum: ["comment", "query", "response", "approved", "declined", "submitted", "withdrawn", "disbursed", "skipped"] }).notNull(),
    body: text("body"),
    createdAt: createdAt(),
  },
  (t) => [index("memo_comments_memo_idx").on(t.memoId, t.createdAt)],
);

/** Who opened a memo and when (the last time per person). */
export const memoViews = pgTable(
  "memo_views",
  {
    orgId: orgId(),
    memoId: uuid("memo_id").notNull(),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    firstAt: ts("first_at").notNull().defaultNow(),
    lastAt: ts("last_at").notNull().defaultNow(),
    count: integer("count").notNull().default(1),
  },
  (t) => [uniqueIndex("memo_views_uq").on(t.memoId, t.userId)],
);
