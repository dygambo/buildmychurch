import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

/* ---------------- prayer ---------------- */

export const PRAYER_CATEGORIES = ["healing", "family", "finances", "career", "salvation", "guidance", "deliverance", "thanksgiving", "other"] as const;

/**
 * A prayer request: from the public prayer page, a visitor card, the member portal or entered by staff.
 * The request text and contact details are encrypted. Confidential ones are seen by pastors only.
 */
export const prayerRequests = pgTable(
  "prayer_requests",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id"),
    memberId: uuid("member_id"),
    name: text("name"),
    phoneEnc: text("phone_enc"),
    emailEnc: text("email_enc"),
    bodyEnc: text("body_enc").notNull(),
    category: text("category", { enum: PRAYER_CATEGORIES }).notNull().default("other"),
    confidential: boolean("confidential").notNull().default(false),
    wantsContact: boolean("wants_contact").notNull().default(false),
    source: text("source", { enum: ["online", "visitor_card", "staff", "portal"] }).notNull(),
    status: text("status", { enum: ["new", "praying", "answered", "closed"] })
      .notNull()
      .default("new"),
    assignedTo: uuid("assigned_to"),
    assignedName: text("assigned_name"),
    prayedCount: integer("prayed_count").notNull().default(0),
    lastPrayedAt: ts("last_prayed_at"),
    testimonyEnc: text("testimony_enc"),
    createdByName: text("created_by_name"),
    closedAt: ts("closed_at"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("prayer_requests_org_idx").on(t.orgId, t.status, t.createdAt), index("prayer_requests_member_idx").on(t.orgId, t.memberId)],
);

/* ---------------- pastoral care ---------------- */

export const CARE_KINDS = ["hospital", "bereavement", "counselling", "welfare", "new_baby", "wedding", "visitation", "other"] as const;

/** Someone the pastoral team is looking after: a hospital stay, a bereavement, counselling or a welfare need. */
export const careCases = pgTable(
  "care_cases",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    memberId: uuid("member_id").notNull(),
    kind: text("kind", { enum: CARE_KINDS }).notNull(),
    title: text("title").notNull(),
    summaryEnc: text("summary_enc"),
    priority: text("priority", { enum: ["normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    /** Pastors only: counselling and anything marked confidential. */
    confidential: boolean("confidential").notNull().default(false),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    assignedTo: uuid("assigned_to"),
    assignedName: text("assigned_name"),
    nextActionOn: date("next_action_on"),
    nextAction: text("next_action"),
    prayerRequestId: uuid("prayer_request_id"),
    openedBy: uuid("opened_by"),
    openedByName: text("opened_by_name"),
    closedAt: ts("closed_at"),
    closedNote: text("closed_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("care_cases_org_idx").on(t.orgId, t.status, t.nextActionOn), index("care_cases_member_idx").on(t.orgId, t.memberId)],
);

/** The case log: visits, calls, notes, and welfare given. Welfare amounts are in kobo. */
export const careEntries = pgTable(
  "care_entries",
  {
    id: id(),
    orgId: orgId(),
    caseId: uuid("case_id").notNull(),
    kind: text("kind", { enum: ["note", "visit", "call", "welfare"] }).notNull(),
    bodyEnc: text("body_enc"),
    happenedOn: date("happened_on").notNull(),
    amountKobo: bigint("amount_kobo", { mode: "number" }),
    welfareKind: text("welfare_kind", { enum: ["cash", "transfer", "foodstuff", "hospital_bill", "school_fees", "rent", "other"] }),
    authorId: uuid("author_id"),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("care_entries_case_idx").on(t.orgId, t.caseId, t.happenedOn), check("care_entries_amount_ck", sql`${t.amountKobo} is null or ${t.amountKobo} > 0`)],
);

/* ---------------- forms ---------------- */

export type FormField = {
  id: string;
  type: "short" | "long" | "email" | "phone" | "number" | "date" | "choice" | "multi" | "yesno" | "section";
  label: string;
  help?: string;
  required?: boolean;
  options?: string[];
};

/** A form the church builds: workers' training sign-up, baptism class, survey, feedback. */
export const forms = pgTable(
  "forms",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    description: text("description"),
    fields: jsonb("fields").$type<FormField[]>().notNull().default([]),
    status: text("status", { enum: ["draft", "open", "closed"] })
      .notNull()
      .default("draft"),
    closesAt: ts("closes_at"),
    maxResponses: integer("max_responses"),
    oneEach: boolean("one_each").notNull().default(false),
    thankYou: text("thank_you"),
    notifyEmail: text("notify_email"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("forms_org_idx").on(t.orgId, t.createdAt)],
);

/** One submission. Answers are encrypted because forms often ask for phone numbers, addresses or health details. */
export const formResponses = pgTable(
  "form_responses",
  {
    id: id(),
    orgId: orgId(),
    formId: uuid("form_id").notNull(),
    answersEnc: text("answers_enc").notNull(),
    name: text("name"),
    contactHash: text("contact_hash"),
    memberId: uuid("member_id"),
    createdAt: createdAt(),
  },
  (t) => [index("form_responses_form_idx").on(t.orgId, t.formId, t.createdAt), index("form_responses_contact_idx").on(t.formId, t.contactHash)],
);
