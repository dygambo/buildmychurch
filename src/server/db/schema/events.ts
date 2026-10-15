import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, ts, updatedAt } from "./_helpers";

const kobo = (name: string) => bigint(name, { mode: "number" });

/** Conferences, retreats, concerts, outreaches: with free or paid registration and ticket check-in. */
export const events = pgTable(
  "events",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at"),
    venue: text("venue"),
    /** Total places across ticket types; null means no limit. */
    capacity: integer("capacity"),
    status: text("status", { enum: ["draft", "published", "cancelled"] })
      .notNull()
      .default("draft"),
    registrationOpen: boolean("registration_open").notNull().default(true),
    closesAt: ts("closes_at"),
    /** Ask for a phone number as well as an email. */
    askPhone: boolean("ask_phone").notNull().default(true),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("events_org_start_idx").on(t.orgId, t.startsAt)],
);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: id(),
    orgId: orgId(),
    eventId: uuid("event_id").notNull(),
    name: text("name").notNull(),
    priceKobo: kobo("price_kobo").notNull().default(0),
    capacity: integer("capacity"),
    position: integer("position").notNull().default(0),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [check("ticket_types_price_ck", sql`${t.priceKobo} >= 0`)],
);

export const eventRegistrations = pgTable(
  "event_registrations",
  {
    id: id(),
    orgId: orgId(),
    eventId: uuid("event_id").notNull(),
    ticketTypeId: uuid("ticket_type_id").notNull(),
    memberId: uuid("member_id"),
    name: text("name").notNull(),
    emailEnc: text("email_enc"),
    emailHash: text("email_hash"),
    phoneEnc: text("phone_enc"),
    quantity: integer("quantity").notNull().default(1),
    amountKobo: kobo("amount_kobo").notNull().default(0),
    status: text("status", { enum: ["pending", "confirmed", "cancelled", "failed"] })
      .notNull()
      .default("pending"),
    /** Printed under the QR code on the ticket. Unguessable, so the ticket page needs no sign-in. */
    code: text("code").notNull(),
    paymentRef: text("payment_ref"),
    /** How many of the tickets on this registration have come in. */
    checkedIn: integer("checked_in").notNull().default(0),
    lastCheckinAt: ts("last_checkin_at"),
    lastCheckinBy: text("last_checkin_by"),
    source: text("source", { enum: ["online", "desk"] })
      .notNull()
      .default("online"),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("event_registrations_code_uq").on(t.code),
    index("event_registrations_event_idx").on(t.orgId, t.eventId, t.status),
    check("event_registrations_qty_ck", sql`${t.quantity} between 1 and 20 and ${t.checkedIn} between 0 and ${t.quantity}`),
  ],
);

/* ---------------- volunteer rota ---------------- */

/** One person serving in one position on one day: "Usher, main door, Sunday 18 Oct". */
export const rotaSlots = pgTable(
  "rota_slots",
  {
    id: id(),
    orgId: orgId(),
    branchId: uuid("branch_id").notNull(),
    groupId: uuid("group_id").notNull(),
    date: date("date").notNull(),
    serviceLabel: text("service_label").notNull().default("Sunday service"),
    position: text("position").notNull(),
    memberId: uuid("member_id"),
    status: text("status", { enum: ["open", "assigned", "confirmed", "declined"] })
      .notNull()
      .default("open"),
    declineReason: text("decline_reason"),
    respondedAt: ts("responded_at"),
    remindedAt: ts("reminded_at"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rota_slots_org_date_idx").on(t.orgId, t.date, t.groupId), index("rota_slots_member_idx").on(t.orgId, t.memberId, t.date)],
);
