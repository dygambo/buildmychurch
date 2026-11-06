import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

export const SCHEDULE_TYPES = ["sunday", "midweek", "prayer", "communion", "special", "wedding", "funeral", "custom"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

/**
 * The order of service for one service: who does what, when. Edited freely as a draft; publishing freezes a
 * numbered version (with its PDF) and tells the people whose part is new or has changed.
 */
export const serviceSchedules = pgTable(
  "service_schedules",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    title: text("title").notNull(),
    serviceType: text("service_type", { enum: SCHEDULE_TYPES }).notNull(),
    /** For "custom", or to name a special programme. */
    typeLabel: text("type_label"),
    serviceDate: date("service_date").notNull(),
    /** "08:00", Lagos time. */
    startTime: text("start_time").notNull(),
    endTime: text("end_time"),
    venue: text("venue"),
    theme: text("theme"),
    scripture: text("scripture"),
    presidingName: text("presiding_name"),
    presidingMemberId: uuid("presiding_member_id"),
    /** Printed on the PDF and shown to everyone who can see the schedule. */
    announcements: text("announcements"),
    /** For the coordinators only: never printed, never sent. */
    internalNotes: text("internal_notes"),
    status: text("status", { enum: ["draft", "published", "completed", "archived"] })
      .notNull()
      .default("draft"),
    /** The latest published version; 0 until first published. */
    currentVersion: integer("current_version").notNull().default(0),
    /** Saved edits that haven't been published yet. */
    hasChanges: boolean("has_changes").notNull().default(false),
    serviceId: uuid("service_id"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name").notNull(),
    updatedBy: uuid("updated_by"),
    updatedByName: text("updated_by_name"),
    firstPublishedAt: ts("first_published_at"),
    lastPublishedAt: ts("last_published_at"),
    archivedAt: ts("archived_at"),
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("service_schedules_org_date_idx").on(t.orgId, t.serviceDate),
    index("service_schedules_org_status_idx").on(t.orgId, t.status),
  ],
);

export type CustomField = { label: string; value: string };

/** One part of the programme, in order. Nothing is fixed: churches add, rename, reorder and remove freely. */
export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: id(),
    orgId: orgId(),
    scheduleId: uuid("schedule_id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    startTime: text("start_time"),
    durationMin: integer("duration_min"),
    /** Instructions printed with the item. */
    description: text("description"),
    /** For coordinators only. */
    notes: text("notes"),
    custom: jsonb("custom").$type<CustomField[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index("schedule_items_schedule_idx").on(t.scheduleId, t.position),
    check("schedule_items_duration_ck", sql`${t.durationMin} is null or (${t.durationMin} > 0 and ${t.durationMin} <= 720)`),
  ],
);

/** Who does an item: a member, a staff user, or a group (choir) or name typed in. One person can have many items. */
export const scheduleAssignments = pgTable(
  "schedule_assignments",
  {
    id: id(),
    orgId: orgId(),
    scheduleId: uuid("schedule_id").notNull(),
    itemId: uuid("item_id").notNull(),
    memberId: uuid("member_id"),
    userId: uuid("user_id"),
    groupId: uuid("group_id"),
    name: text("name").notNull(),
    responsibility: text("responsibility"),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_assignments_schedule_idx").on(t.scheduleId), index("schedule_assignments_member_idx").on(t.orgId, t.memberId)],
);

export type ScheduleTemplateBody = {
  title: string;
  startTime: string;
  endTime?: string | null;
  venue?: string | null;
  announcements?: string | null;
  items: { title: string; durationMin?: number | null; description?: string | null }[];
};

export const scheduleTemplates = pgTable("schedule_templates", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  serviceType: text("service_type", { enum: SCHEDULE_TYPES }).notNull(),
  body: jsonb("body").$type<ScheduleTemplateBody>().notNull(),
  createdBy: uuid("created_by"),
  createdByName: text("created_by_name"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** What a published version contained, exactly as it was printed. */
export type ScheduleSnapshot = {
  title: string;
  serviceType: string;
  typeLabel: string | null;
  serviceDate: string;
  startTime: string;
  endTime: string | null;
  venue: string | null;
  theme: string | null;
  scripture: string | null;
  presidingName: string | null;
  announcements: string | null;
  branchName: string;
  items: {
    id: string;
    title: string;
    startTime: string | null;
    durationMin: number | null;
    description: string | null;
    custom: CustomField[];
    assignees: { key: string; name: string; responsibility: string | null }[];
  }[];
};

/** Every published version is kept, with its PDF, so anyone can see what was sent and when. */
export const scheduleVersions = pgTable(
  "schedule_versions",
  {
    id: id(),
    orgId: orgId(),
    scheduleId: uuid("schedule_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<ScheduleSnapshot>().notNull(),
    changeSummary: text("change_summary"),
    note: text("note"),
    publishedBy: uuid("published_by"),
    publishedByName: text("published_by_name").notNull(),
    publishedAt: ts("published_at").notNull().defaultNow(),
    fileId: uuid("file_id"),
    pdfStatus: text("pdf_status", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    pdfError: text("pdf_error"),
  },
  (t) => [uniqueIndex("schedule_versions_uq").on(t.scheduleId, t.version)],
);

/**
 * One notification to one person about one version. "sent" means the provider accepted it;
 * "delivered" only when the provider confirmed it.
 */
export const scheduleNotifications = pgTable(
  "schedule_notifications",
  {
    id: id(),
    orgId: orgId(),
    scheduleId: uuid("schedule_id").notNull(),
    version: integer("version").notNull(),
    /** member:<id>, user:<id>; the same person across versions. */
    recipientKey: text("recipient_key").notNull(),
    recipientName: text("recipient_name").notNull(),
    reason: text("reason", { enum: ["published", "assigned", "changed", "removed", "resend"] }).notNull(),
    /** What changed for this person, in plain words. */
    detail: text("detail"),
    channel: text("channel", { enum: ["email", "sms", "whatsapp"] }),
    toMasked: text("to_masked"),
    status: text("status", { enum: ["pending", "sent", "delivered", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    messageId: uuid("message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: ts("sent_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("schedule_notifications_schedule_idx").on(t.scheduleId, t.version)],
);
