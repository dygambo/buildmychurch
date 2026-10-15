import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

export const STAGES = ["visitor", "first_timer", "second_timer", "regular", "member"] as const;
export const MEMBER_STATUS = ["active", "inactive", "transferred", "deceased"] as const;

/**
 * Members. Contact and health fields are encrypted at rest (AES-256-GCM);
 * *_hash columns are keyed blind indexes so we can find duplicates and look people up by phone or email.
 */
export const members = pgTable(
  "members",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    memberNo: text("member_no").notNull(),
    title: text("title"),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    gender: text("gender", { enum: ["male", "female"] }).notNull(),
    dobDay: smallint("dob_day"),
    dobMonth: smallint("dob_month"),
    dobYear: smallint("dob_year"),
    maritalStatus: text("marital_status", { enum: ["single", "married", "widowed", "divorced", "separated"] }),
    anniversary: date("anniversary"),
    phoneEnc: text("phone_enc"),
    phoneHash: text("phone_hash"),
    phoneLast4: text("phone_last4"),
    emailEnc: text("email_enc"),
    emailHash: text("email_hash"),
    addressEnc: text("address_enc"),
    area: text("area"),
    occupation: text("occupation"),
    employer: text("employer"),
    bloodGroupEnc: text("blood_group_enc"),
    genotypeEnc: text("genotype_enc"),
    stage: text("stage", { enum: STAGES }).notNull().default("member"),
    status: text("status", { enum: MEMBER_STATUS }).notNull().default("active"),
    joinDate: date("join_date")
      .notNull()
      .default(sql`CURRENT_DATE`),
    baptism: text("baptism", { enum: ["none", "water", "spirit", "both"] })
      .notNull()
      .default("none"),
    foundationSchoolAt: date("foundation_school_at"),
    householdId: uuid("household_id"),
    householdRole: text("household_role", { enum: ["head", "spouse", "child", "relative"] }),
    dnd: boolean("dnd").notNull().default(false),
    consentMessaging: boolean("consent_messaging").notNull().default(false),
    consentHealth: boolean("consent_health").notNull().default(false),
    consentPhoto: boolean("consent_photo").notNull().default(false),
    custom: jsonb("custom").$type<Record<string, string>>().notNull().default({}),
    howHeard: text("how_heard"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("members_org_no_uq").on(t.orgId, t.memberNo),
    index("members_org_phone_idx").on(t.orgId, t.phoneHash),
    index("members_org_email_idx").on(t.orgId, t.emailHash),
    index("members_org_bday_idx").on(t.orgId, t.dobMonth, t.dobDay),
    index("members_org_branch_idx").on(t.orgId, t.branchId),
    index("members_name_trgm_idx").using("gin", sql`(lower(${t.firstName} || ' ' || ${t.lastName})) gin_trgm_ops`),
  ],
);

export const households = pgTable("households", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const tags = pgTable(
  "tags",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_org_name_uq").on(t.orgId, t.name)],
);

export const memberTags = pgTable(
  "member_tags",
  {
    orgId: orgId(),
    memberId: uuid("member_id").notNull(),
    tagId: uuid("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.tagId] })],
);

/** Departments, home cells and ministries. */
export const groups = pgTable(
  "groups",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    kind: text("kind", { enum: ["department", "cell", "ministry"] }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    leaderMemberId: uuid("leader_member_id"),
    meetingDay: text("meeting_day"),
    meetingTime: text("meeting_time"),
    location: text("location"),
    area: text("area"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("groups_org_branch_name_uq").on(t.orgId, t.branchId, t.kind, t.name)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    orgId: orgId(),
    groupId: uuid("group_id").notNull(),
    memberId: uuid("member_id").notNull(),
    role: text("role", { enum: ["leader", "assistant", "member"] })
      .notNull()
      .default("member"),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.memberId] }), index("group_members_member_idx").on(t.memberId)],
);

/** Proof of consent under the NDPA: who agreed to what, when and how. */
export const consents = pgTable("consents", {
  id: id(),
  orgId: orgId(),
  memberId: uuid("member_id").notNull(),
  purpose: text("purpose", { enum: ["messaging", "health", "photo", "child_records"] }).notNull(),
  granted: boolean("granted").notNull(),
  method: text("method").notNull(),
  capturedBy: uuid("captured_by"),
  createdAt: createdAt(),
});

export const importJobs = pgTable("import_jobs", {
  id: id(),
  orgId: orgId(),
  filename: text("filename").notNull(),
  status: text("status", { enum: ["validated", "committed", "rolled_back"] })
    .notNull()
    .default("validated"),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  report: jsonb("report").$type<{ row: number; problem: string; value?: string }[]>().notNull().default([]),
  rows: jsonb("rows").$type<Record<string, unknown>[]>().notNull().default([]),
  memberIds: uuid("member_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  createdBy: uuid("created_by"),
  committedAt: ts("committed_at"),
  createdAt: createdAt(),
});

export const dataRequests = pgTable("data_requests", {
  id: id(),
  orgId: orgId(),
  memberId: uuid("member_id").notNull(),
  type: text("type", { enum: ["access", "correction", "deletion", "portability"] }).notNull(),
  status: text("status", { enum: ["open", "completed", "rejected"] })
    .notNull()
    .default("open"),
  dueAt: ts("due_at").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});
