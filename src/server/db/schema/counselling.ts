import { date, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

export type ChecklistItem = { key: string; label: string; done: boolean; doneAt?: string | null; note?: string | null };

/**
 * One couple in marriage counselling: preparing for marriage (pre-marital) or getting help in their marriage.
 * Everything personal is encrypted, and only pastors and the couple's own counsellors can open it.
 */
export const counsellingCases = pgTable(
  "counselling_cases",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    refNo: text("ref_no").notNull(),
    kind: text("kind", { enum: ["premarital", "marital"] }).notNull(),
    status: text("status", { enum: ["enquiry", "active", "on_hold", "completed", "closed"] })
      .notNull()
      .default("enquiry"),
    source: text("source", { enum: ["staff", "online"] }).notNull(),
    // the two partners: linked to member records when they are members
    aMemberId: uuid("a_member_id"),
    aName: text("a_name").notNull(),
    aPhoneEnc: text("a_phone_enc"),
    aEmailEnc: text("a_email_enc"),
    bMemberId: uuid("b_member_id"),
    bName: text("b_name").notNull(),
    bPhoneEnc: text("b_phone_enc"),
    bEmailEnc: text("b_email_enc"),
    /** Pre-marital: the planned wedding. */
    weddingDate: date("wedding_date"),
    weddingVenue: text("wedding_venue"),
    /** Marital: when they married. */
    marriedSince: date("married_since"),
    /** Why they came, in their words (encrypted). */
    reasonEnc: text("reason_enc"),
    counsellorIds: uuid("counsellor_ids").array().notNull().default([]),
    checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
    plannedSessions: integer("planned_sessions").notNull().default(8),
    /** Private summary for the pastors (encrypted). */
    summaryEnc: text("summary_enc"),
    outcome: text("outcome", { enum: ["cleared", "not_cleared", "reconciled", "referred", "withdrew", "other"] }),
    certificateNo: text("certificate_no"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("counselling_cases_org_idx").on(t.orgId, t.status, t.createdAt)],
);

export const counsellingSessions = pgTable(
  "counselling_sessions",
  {
    id: id(),
    orgId: orgId(),
    caseId: uuid("case_id").notNull(),
    topic: text("topic").notNull(),
    startsAt: ts("starts_at").notNull(),
    durationMin: integer("duration_min").notNull().default(60),
    location: text("location"),
    counsellorId: uuid("counsellor_id"),
    counsellorName: text("counsellor_name"),
    status: text("status", { enum: ["scheduled", "held", "missed", "cancelled"] })
      .notNull()
      .default("scheduled"),
    /** Counsellor's private notes (encrypted). Never shown to the couple. */
    notesEnc: text("notes_enc"),
    /** What the couple should do before the next session; included in their reminder. */
    homework: text("homework"),
    attended: text("attended", { enum: ["both", "a", "b", "neither"] }),
    remindedAt: ts("reminded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("counselling_sessions_case_idx").on(t.orgId, t.caseId, t.startsAt), index("counselling_sessions_time_idx").on(t.orgId, t.startsAt)],
);
