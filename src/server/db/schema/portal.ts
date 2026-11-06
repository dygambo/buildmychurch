import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts } from "./_helpers";

/**
 * One-time sign-in codes for the member portal, sent by SMS or email. Only a hash is stored.
 * Row-level security applies: codes are created and checked inside the church's context.
 */
export const memberCodes = pgTable(
  "member_codes",
  {
    id: id(),
    orgId: orgId(),
    memberId: uuid("member_id").notNull(),
    codeHash: text("code_hash").notNull(),
    channel: text("channel", { enum: ["sms", "email"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("member_codes_member_idx").on(t.orgId, t.memberId, t.createdAt)],
);

/**
 * Member portal sessions, separate from staff sessions. Looked up by the SHA-256 of the cookie token
 * before the church is known, like staff sessions, so this table sits outside row-level security.
 */
export const memberSessions = pgTable(
  "member_sessions",
  {
    id: text("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    memberId: uuid("member_id").notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("member_sessions_member_idx").on(t.memberId)],
);
