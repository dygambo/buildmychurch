import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  bigserial,
  customType,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

/** A church (tenant). Denominations are organisations with many branches. */
export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  denomination: text("denomination"),
  state: text("state"),
  lga: text("lga"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  timezone: text("timezone").notNull().default("Africa/Lagos"),
  currency: text("currency").notNull().default("NGN"),
  smsSenderId: text("sms_sender_id"),
  logoFileId: uuid("logo_file_id"),
  plan: text("plan", { enum: ["free", "starter", "growth", "denomination"] })
    .notNull()
    .default("free"),
  status: text("status", { enum: ["trial", "active", "suspended"] })
    .notNull()
    .default("trial"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    orgId: orgId().references(() => organisations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    code: text("code").notNull(),
    /** Materialised path of codes, e.g. "hq.wuse" — used for "this branch and everything under it". */
    path: text("path").notNull(),
    level: text("level", { enum: ["hq", "region", "zone", "branch"] })
      .notNull()
      .default("branch"),
    address: text("address"),
    phone: text("phone"),
    pastorName: text("pastor_name"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("branches_org_code_uq").on(t.orgId, t.code), index("branches_org_path_idx").on(t.orgId, t.path)],
);

/** People who can sign in. A user can belong to several churches. */
export const users = pgTable("users", {
  id: id(),
  email: citext("email").notNull().unique(),
  phone: text("phone"),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaRecoveryHashes: jsonb("mfa_recovery_hashes").$type<string[]>().notNull().default([]),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    orgId: orgId().references(() => organisations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_org_key_uq").on(t.orgId, t.key)],
);

/** A user's place in a church: role plus the branches they may see (empty = all). */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: orgId().references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    branchIds: uuid("branch_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    title: text("title"),
    staffId: text("staff_id"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id"),
    mfaPending: boolean("mfa_pending").notNull().default(false),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id"),
  email: citext("email"),
  purpose: text("purpose", { enum: ["password_reset", "email_verify", "invite"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** Append-only audit trail. The app role has no UPDATE or DELETE grant on this table. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: orgId(),
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_entity_idx").on(t.orgId, t.entityType, t.entityId),
  ],
);

/** Postgres-backed job queue (SKIP LOCKED). Used for messages, PDFs, imports and scheduled automations. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    orgId: uuid("org_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("queued"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    dedupeKey: text("dedupe_key").unique(),
    doneAt: ts("done_at"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_pick_idx").on(t.status, t.runAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: ts("reset_at").notNull(),
});

/**
 * Uploaded files (receipts, invoices, memo attachments, photos), each attached to one record.
 * The bytes live in the storage provider under `storageKey`.
 */
export const files = pgTable(
  "files",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    uploadedBy: uuid("uploaded_by"),
    uploadedByName: text("uploaded_by_name"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("files_entity_idx").on(t.orgId, t.entityType, t.entityId)],
);

/** Development mailbox: when EMAIL_PROVIDER=log, emails land here instead of being sent. */
export const devMailbox = pgTable("dev_mailbox", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  text: text("text"),
  channel: text("channel", { enum: ["email", "sms"] })
    .notNull()
    .default("email"),
  createdAt: createdAt(),
});
