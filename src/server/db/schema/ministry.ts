import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

/* ---------------- public links (no row-level security: looked up before we know the church) ---------------- */

/**
 * Unguessable tokens behind printed QR codes: self check-in for a service, the visitor card,
 * and so on. The token tells us which church and record it belongs to; everything after that runs
 * under that church's row-level security.
 */
export const publicLinks = pgTable("public_links", {
  token: text("token").primaryKey(),
  orgId: orgId(),
  kind: text("kind", { enum: ["service_checkin", "visitor_form"] }).notNull(),
  targetId: uuid("target_id"),
  createdAt: createdAt(),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
});

/* ---------------- services and attendance ---------------- */

export const SERVICE_KINDS = ["sunday", "midweek", "special", "vigil", "youth", "children", "other"] as const;

/** Regular services, used to create each week's service in one tap. */
export const serviceTemplates = pgTable("service_templates", {
  id: id(),
  orgId: orgId(),
  branchId: uuid("branch_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: SERVICE_KINDS }).notNull().default("sunday"),
  weekday: smallint("weekday").notNull(), // 0 = Sunday
  startTime: time("start_time").notNull(),
  durationMin: integer("duration_min").notNull().default(120),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const services = pgTable(
  "services",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    templateId: uuid("template_id"),
    name: text("name").notNull(),
    kind: text("kind", { enum: SERVICE_KINDS }).notNull().default("sunday"),
    date: date("date").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    // headcount by the ushers (people who didn't check in individually are still counted here)
    men: integer("men"),
    women: integer("women"),
    children: integer("children"),
    online: integer("online"),
    firstTimersCount: integer("first_timers_count"),
    countNotes: text("count_notes"),
    countedBy: uuid("counted_by"),
    countedAt: ts("counted_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("services_org_date_idx").on(t.orgId, t.date),
    uniqueIndex("services_template_date_uq").on(t.templateId, t.date),
  ],
);

export const attendance = pgTable(
  "attendance",
  {
    orgId: orgId(),
    serviceId: uuid("service_id").notNull(),
    memberId: uuid("member_id").notNull(),
    method: text("method", { enum: ["self_qr", "staff", "import"] }).notNull(),
    checkedInAt: ts("checked_in_at").notNull().defaultNow(),
    checkedInBy: uuid("checked_in_by"),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.memberId] }), index("attendance_member_idx").on(t.orgId, t.memberId)],
);

/* ---------------- first timers and follow-up ---------------- */

export const FOLLOWUP_STAGES = ["new", "contacted", "visited", "integrated", "closed"] as const;

export const followups = pgTable(
  "followups",
  {
    id: id(),
    orgId: orgId(),
    memberId: uuid("member_id").notNull(),
    reason: text("reason", { enum: ["first_timer", "absentee", "new_convert", "other"] }).notNull(),
    stage: text("stage", { enum: FOLLOWUP_STAGES }).notNull().default("new"),
    assignedTo: uuid("assigned_to"),
    dueAt: ts("due_at"),
    prayerRequest: text("prayer_request_enc"),
    wantsVisit: boolean("wants_visit").notNull().default(false),
    closedReason: text("closed_reason"),
    lastContactAt: ts("last_contact_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("followups_org_stage_idx").on(t.orgId, t.stage), index("followups_member_idx").on(t.orgId, t.memberId)],
);

export const followupNotes = pgTable(
  "followup_notes",
  {
    id: id(),
    orgId: orgId(),
    followupId: uuid("followup_id").notNull(),
    method: text("method", { enum: ["call", "sms", "whatsapp", "visit", "email", "in_person", "note"] }).notNull(),
    outcome: text("outcome", { enum: ["reached", "no_answer", "wrong_number", "callback", "done"] }),
    body: text("body_enc"),
    authorId: uuid("author_id"),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("followup_notes_fu_idx").on(t.followupId)],
);

/* ---------------- children ---------------- */

export const children = pgTable(
  "children",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    childNo: text("child_no").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    gender: text("gender", { enum: ["male", "female"] }).notNull(),
    dob: date("dob").notNull(),
    classGroup: text("class_group"),
    allergiesEnc: text("allergies_enc"),
    medicalEnc: text("medical_enc"),
    specialNeedsEnc: text("special_needs_enc"),
    notes: text("notes"),
    photoConsent: boolean("photo_consent").notNull().default(false),
    /** What the child's QR tag encodes. Rotating it invalidates a lost tag. */
    qrToken: text("qr_token").notNull(),
    status: text("status", { enum: ["active", "graduated", "inactive"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("children_qr_uq").on(t.qrToken),
    uniqueIndex("children_org_no_uq").on(t.orgId, t.childNo),
    index("children_name_trgm_idx").using("gin", sql`(lower(${t.firstName} || ' ' || ${t.lastName})) gin_trgm_ops`),
  ],
);

export const guardians = pgTable(
  "guardians",
  {
    id: id(),
    orgId: orgId(),
    memberId: uuid("member_id"),
    title: text("title"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phoneEnc: text("phone_enc"),
    phoneHash: text("phone_hash"),
    emailEnc: text("email_enc"),
    emailHash: text("email_hash"),
    addressEnc: text("address_enc"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("guardians_phone_idx").on(t.orgId, t.phoneHash)],
);

export const childGuardians = pgTable(
  "child_guardians",
  {
    orgId: orgId(),
    childId: uuid("child_id").notNull(),
    guardianId: uuid("guardian_id").notNull(),
    relationship: text("relationship").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    canPickUp: boolean("can_pick_up").notNull().default(true),
    notify: boolean("notify").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.childId, t.guardianId] })],
);

/** One row per visit. Open while the child is in church; closed at pickup. */
export const childCheckins = pgTable(
  "child_checkins",
  {
    id: id(),
    orgId: orgId(),
    childId: uuid("child_id").notNull(),
    serviceId: uuid("service_id"),
    classGroup: text("class_group"),
    /** Printed on the parent's pickup slip; must match at checkout. */
    securityCode: text("security_code").notNull(),
    checkedInAt: ts("checked_in_at").notNull().defaultNow(),
    checkedInBy: uuid("checked_in_by").notNull(),
    checkedInByName: text("checked_in_by_name").notNull(),
    droppedOffBy: uuid("dropped_off_by"),
    checkInMethod: text("check_in_method", { enum: ["qr", "manual"] }).notNull(),
    checkedOutAt: ts("checked_out_at"),
    checkedOutBy: uuid("checked_out_by"),
    checkedOutByName: text("checked_out_by_name"),
    pickedUpBy: uuid("picked_up_by"),
    checkOutMethod: text("check_out_method", { enum: ["qr", "manual", "code"] }),
    overrideReason: text("override_reason"),
  },
  (t) => [
    index("child_checkins_child_idx").on(t.orgId, t.childId, t.checkedInAt),
    // a child can only be checked in once at a time
    uniqueIndex("child_checkins_open_uq")
      .on(t.childId)
      .where(sql`${t.checkedOutAt} is null`),
  ],
);

/**
 * Tamper-evident log of every check-in and check-out. Each row stores the SHA-256 of the previous
 * row's hash plus its own content, so editing or deleting any past row breaks the chain.
 * The app's database role can only insert here.
 */
export const childEvents = pgTable(
  "child_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    orgId: orgId(),
    childId: uuid("child_id").notNull(),
    checkinId: uuid("checkin_id").notNull(),
    type: text("type", { enum: ["check_in", "check_out"] }).notNull(),
    at: ts("at").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("child_events_org_seq_idx").on(t.orgId, t.seq)],
);
