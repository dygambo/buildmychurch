import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import {
  branches,
  eventRegistrations,
  events,
  givingFunds,
  givingTransactions,
  members,
  organisations,
  paymentIntents,
  publicLinks,
  ticketTypes,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan, systemActor } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { PaymentsNotConfigured, paymentsProvider } from "../providers/payments";
import { formatDate, formatDateTime, formatTime, naira, todayISO } from "@/lib/format";
import { normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";
import { givingSettings, newReference } from "./giving";

/* ================= editing events ================= */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);
const naira2kobo = (v: unknown) => Math.round(Number(String(v ?? "0").replace(/[₦,\s]/g, "") || 0) * 100);
const optInt = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v, c) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) {
      c.addIssue({ code: "custom", message: "Enter a whole number, or leave it empty for no limit." });
      return z.NEVER;
    }
    return n;
  });
/** "2026-11-20T18:00" typed in Lagos → Date. */
const lagosDateTime = (msg: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, msg)
    .transform((v) => new Date(`${v}:00+01:00`));

export const eventSchema = z
  .object({
    id: z.string().uuid().optional(),
    branchId: z.string().uuid("Choose a branch."),
    title: z.string().trim().min(3, "Name the event.").max(140),
    description: optText(5000),
    startsAt: lagosDateTime("Choose when it starts."),
    endsAt: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(`${v}:00+01:00`) : null)),
    venue: optText(200),
    capacity: optInt,
    closesAt: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(`${v}:00+01:00`) : null)),
    askPhone: z.boolean().default(true),
    tickets: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(2, "Name the ticket.").max(60),
          price: z.union([z.string(), z.number()]).transform((v, c) => {
            const k = naira2kobo(v);
            if (!Number.isFinite(k) || k < 0) {
              c.addIssue({ code: "custom", message: "Enter 0 for free, or the price." });
              return z.NEVER;
            }
            if (k > 0 && k < 10_000) {
              c.addIssue({ code: "custom", message: "Paid tickets start at ₦100." });
              return z.NEVER;
            }
            return k;
          }),
          capacity: optInt,
        }),
      )
      .min(1, "Add at least one ticket type, e.g. General admission (free).")
      .max(10),
  })
  .superRefine((v, c) => {
    if (v.endsAt && v.endsAt <= v.startsAt) c.addIssue({ code: "custom", path: ["endsAt"], message: "It has to end after it starts." });
    if (v.closesAt && v.closesAt > (v.endsAt ?? v.startsAt)) c.addIssue({ code: "custom", path: ["closesAt"], message: "Close registration before the event ends." });
  });

export async function saveEvent(tx: Tx, ctx: Actor, input: z.output<typeof eventSchema>) {
  assertCan(ctx, "events.manage", "manage events");
  assertBranch(ctx, input.branchId);
  const values = {
    branchId: input.branchId,
    title: input.title,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    venue: input.venue,
    capacity: input.capacity,
    closesAt: input.closesAt,
    askPhone: input.askPhone,
  };
  let id = input.id;
  if (id) {
    const [e] = await tx.select().from(events).where(eq(events.id, id)).for("update");
    if (!e) throw notFound("That event");
    assertBranch(ctx, e.branchId);
    if (e.status === "cancelled") throw new AppError("This event was cancelled and can't be edited.");
    await tx.update(events).set(values).where(eq(events.id, id));
    const existing = await tx.select().from(ticketTypes).where(eq(ticketTypes.eventId, id));
    const keep = new Set(input.tickets.map((t) => t.id).filter(Boolean));
    for (const old of existing.filter((t) => !keep.has(t.id) && !t.archivedAt)) {
      // tickets people have bought are kept (hidden), never deleted
      const [used] = await tx.select({ n: count() }).from(eventRegistrations).where(eq(eventRegistrations.ticketTypeId, old.id));
      if (Number(used?.n ?? 0)) await tx.update(ticketTypes).set({ archivedAt: new Date() }).where(eq(ticketTypes.id, old.id));
      else await tx.delete(ticketTypes).where(eq(ticketTypes.id, old.id));
    }
    for (const [i, t] of input.tickets.entries()) {
      const prev = existing.find((x) => x.id === t.id);
      if (prev) {
        const [sold] = await tx
          .select({ n: count() })
          .from(eventRegistrations)
          .where(and(eq(eventRegistrations.ticketTypeId, prev.id), inArray(eventRegistrations.status, ["confirmed", "pending"])));
        if (Number(sold?.n ?? 0) && prev.priceKobo !== t.price)
          throw new AppError(`People have already registered for "${prev.name}", so its price can't change. Add a new ticket type instead.`);
        await tx.update(ticketTypes).set({ name: t.name, priceKobo: t.price, capacity: t.capacity, position: i, archivedAt: null }).where(eq(ticketTypes.id, prev.id));
      } else await tx.insert(ticketTypes).values({ orgId: ctx.org.id, eventId: id, name: t.name, priceKobo: t.price, capacity: t.capacity, position: i });
    }
  } else {
    const [e] = await tx.insert(events).values({ ...values, orgId: ctx.org.id, createdBy: ctx.user.id, createdByName: ctx.user.name }).returning({ id: events.id });
    id = e!.id;
    await tx.insert(ticketTypes).values(input.tickets.map((t, i) => ({ orgId: ctx.org.id, eventId: id!, name: t.name, priceKobo: t.price, capacity: t.capacity, position: i })));
  }
  if (input.tickets.some((t) => t.price > 0) && paymentsProvider() === "paystack" && !(await givingSettings(tx, ctx.org.id)).subaccountCode)
    throw new AppError("Paid tickets need online payments set up. Add the church's bank account in Giving settings first, or make the tickets free.");
  await audit(tx, ctx, {
    action: input.id ? "event.updated" : "event.created",
    summary: `${input.id ? "Updated" : "Created"} the event "${input.title}" on ${formatDate(input.startsAt)}`,
    entityType: "event",
    entityId: id,
  });
  return id;
}

export async function setEventStatus(tx: Tx, ctx: Actor, id: string, status: "published" | "cancelled" | "draft") {
  assertCan(ctx, "events.manage", "manage events");
  const [e] = await tx.select().from(events).where(eq(events.id, id)).for("update");
  if (!e) throw notFound("That event");
  assertBranch(ctx, e.branchId);
  if (e.status === "cancelled") throw new AppError("This event was cancelled.");
  await tx.update(events).set({ status }).where(eq(events.id, id));
  if (status === "published") await eventToken(tx, ctx.org.id, id);
  if (status === "cancelled") {
    const regs = await tx
      .select()
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, id), eq(eventRegistrations.status, "confirmed")));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ctx.org.id));
    for (const r of regs) {
      const email = decrypt(r.emailEnc);
      if (email)
        await enqueue(
          tx,
          "email.send",
          {
            to: email,
            subject: `Cancelled: ${e.title}`,
            html: emailLayout({
              church: o!.name,
              heading: "This event has been cancelled",
              bodyHtml:
                p(`Dear ${r.name.split(" ")[0]}, ${e.title} on ${formatDate(e.startsAt, "long")} has been cancelled.`) +
                (r.amountKobo ? p(`You paid ${naira(r.amountKobo)}. The church office will contact you about a refund.`) : ""),
            }),
          },
          { orgId: ctx.org.id, dedupeKey: `event-cancel:${r.id}` },
        );
    }
  }
  await audit(tx, ctx, {
    action: `event.${status}`,
    summary: `${status === "published" ? "Opened registration for" : status === "cancelled" ? "Cancelled" : "Unpublished"} the event "${e.title}"`,
    entityType: "event",
    entityId: id,
  });
}

export async function eventToken(tx: Tx, orgId: string, eventId: string) {
  const [l] = await tx
    .select()
    .from(publicLinks)
    .where(and(eq(publicLinks.orgId, orgId), eq(publicLinks.kind, "event"), eq(publicLinks.targetId, eventId), isNull(publicLinks.revokedAt)));
  if (l) return l.token;
  const token = randomToken(9);
  await tx.insert(publicLinks).values({ token, orgId, kind: "event", targetId: eventId });
  return token;
}

/* ================= reading ================= */

export async function listEvents(tx: Tx, ctx: Actor, opts: { when?: string } = {}) {
  assertCan(ctx, "events.manage", "see events");
  const now = new Date().toISOString();
  const rows = await tx
    .select({
      e: events,
      branchName: branches.name,
      tickets: sql<number>`coalesce((select sum(r.quantity) from event_registrations r where r.event_id = events.id and r.status = 'confirmed'), 0)::int`,
      checkedIn: sql<number>`coalesce((select sum(r.checked_in) from event_registrations r where r.event_id = events.id and r.status = 'confirmed'), 0)::int`,
      revenue: sql<number>`coalesce((select sum(r.amount_kobo) from event_registrations r where r.event_id = events.id and r.status = 'confirmed'), 0)::bigint`,
    })
    .from(events)
    .innerJoin(branches, eq(branches.id, events.branchId))
    .where(
      and(
        branchScope(ctx, events.branchId),
        opts.when === "past" ? lt(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now) : gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now),
      ),
    )
    .orderBy(opts.when === "past" ? desc(events.startsAt) : asc(events.startsAt))
    .limit(100);
  return rows.map((r) => ({ ...r.e, branchName: r.branchName, tickets: r.tickets, checkedIn: r.checkedIn, revenue: Number(r.revenue) }));
}
export type EventRow = Awaited<ReturnType<typeof listEvents>>[number];

export async function getEvent(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "events.manage", "see events");
  const [e] = await tx.select().from(events).where(eq(events.id, id));
  if (!e) throw notFound("That event");
  assertBranch(ctx, e.branchId);
  const types = await tx.select().from(ticketTypes).where(eq(ticketTypes.eventId, id)).orderBy(asc(ticketTypes.position));
  const byType = await tx
    .select({
      ticketTypeId: eventRegistrations.ticketTypeId,
      sold: sql<number>`coalesce(sum(${eventRegistrations.quantity}), 0)::int`,
      inside: sql<number>`coalesce(sum(${eventRegistrations.checkedIn}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${eventRegistrations.amountKobo}), 0)::bigint`,
    })
    .from(eventRegistrations)
    .where(and(eq(eventRegistrations.eventId, id), eq(eventRegistrations.status, "confirmed")))
    .groupBy(eventRegistrations.ticketTypeId);
  const token = e.status === "published" ? await eventToken(tx, ctx.org.id, id) : null;
  return {
    ...e,
    token,
    publicUrl: token ? `${env().APP_URL}/e/${token}` : null,
    types: types.map((t) => {
      const s = byType.find((b) => b.ticketTypeId === t.id);
      return { ...t, priceKobo: Number(t.priceKobo), sold: s?.sold ?? 0, inside: s?.inside ?? 0, revenue: Number(s?.revenue ?? 0) };
    }),
  };
}

export async function listRegistrations(tx: Tx, ctx: Actor, eventId: string, opts: { q?: string; status?: string } = {}) {
  assertCan(ctx, "events.manage", "see registrations");
  const [e] = await tx.select({ branchId: events.branchId }).from(events).where(eq(events.id, eventId));
  if (!e) throw notFound("That event");
  assertBranch(ctx, e.branchId);
  const rows = await tx
    .select({ r: eventRegistrations, ticket: ticketTypes.name })
    .from(eventRegistrations)
    .innerJoin(ticketTypes, eq(ticketTypes.id, eventRegistrations.ticketTypeId))
    .where(
      and(
        eq(eventRegistrations.eventId, eventId),
        opts.status === "all" ? undefined : opts.status === "pending" ? eq(eventRegistrations.status, "pending") : eq(eventRegistrations.status, "confirmed"),
      ),
    )
    .orderBy(desc(eventRegistrations.createdAt))
    .limit(2000);
  const q = opts.q?.trim().toLowerCase();
  return rows
    .map(({ r, ticket }) => ({
      id: r.id,
      name: r.name,
      email: decrypt(r.emailEnc),
      phone: decrypt(r.phoneEnc),
      ticket,
      quantity: r.quantity,
      amountKobo: Number(r.amountKobo),
      status: r.status,
      code: r.code,
      checkedIn: r.checkedIn,
      lastCheckinAt: r.lastCheckinAt,
      memberId: r.memberId,
      source: r.source,
      createdAt: r.createdAt,
    }))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q) || (r.phone ?? "").includes(q));
}
export type RegistrationRow = Awaited<ReturnType<typeof listRegistrations>>[number];

/* ================= public registration ================= */

export async function publicEvent(token: string) {
  const [l] = await db.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!l || l.kind !== "event" || l.revokedAt || !l.targetId) return null;
  return withOrg(l.orgId, async (tx) => {
    const [e] = await tx.select().from(events).where(eq(events.id, l.targetId!));
    if (!e || e.status === "draft") return null;
    const [o] = await tx.select({ name: organisations.name, slug: organisations.slug }).from(organisations).where(eq(organisations.id, l.orgId));
    const types = await tx
      .select({ t: ticketTypes })
      .from(ticketTypes)
      .where(and(eq(ticketTypes.eventId, e.id), isNull(ticketTypes.archivedAt)))
      .orderBy(asc(ticketTypes.position));
    const perType = await tx
      .select({ id: eventRegistrations.ticketTypeId, n: sql<number>`coalesce(sum(${eventRegistrations.quantity}), 0)::int` })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, e.id),
          or(eq(eventRegistrations.status, "confirmed"), and(eq(eventRegistrations.status, "pending"), gt(eventRegistrations.createdAt, new Date(Date.now() - 30 * 60_000)))),
        ),
      )
      .groupBy(eventRegistrations.ticketTypeId);
    const taken = perType.reduce((t, x) => t + x.n, 0);
    const left = e.capacity ? Math.max(0, e.capacity - taken) : null;
    const ended = (e.endsAt ?? e.startsAt) < new Date();
    const closed = e.status === "cancelled" || !e.registrationOpen || ended || (e.closesAt && e.closesAt < new Date()) || left === 0;
    return {
      orgId: l.orgId,
      church: o!.name,
      event: { id: e.id, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue, askPhone: e.askPhone, status: e.status },
      left,
      closed: !!closed,
      closedReason: e.status === "cancelled" ? "This event has been cancelled." : ended ? "This event has ended." : left === 0 ? "This event is full." : closed ? "Registration has closed." : null,
      types: types.map(({ t }) => {
        const used = perType.find((x) => x.id === t.id)?.n ?? 0;
        const typeLeft = t.capacity ? Math.max(0, t.capacity - used) : null;
        return { id: t.id, name: t.name, priceKobo: Number(t.priceKobo), left: left === null ? typeLeft : typeLeft === null ? left : Math.min(left, typeLeft) };
      }),
      testMode: (() => {
        try {
          return paymentsProvider() === "fake";
        } catch {
          return false;
        }
      })(),
    };
  });
}

export const registerSchema = z
  .object({
    ticketTypeId: z.string().uuid("Choose a ticket."),
    quantity: z.coerce.number().int().min(1).max(10, "Up to 10 tickets at a time."),
    name: z.string().trim().min(3, "Enter your full name.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email so we can send your ticket."),
    phone: optText(30),
  })
  .superRefine((v, c) => {
    if (v.phone && !normalizeNgPhone(v.phone)) c.addIssue({ code: "custom", path: ["phone"], message: "Enter a Nigerian phone number, e.g. 0803 123 4567." });
  });

const newCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(10);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
};

/** Registers someone from the public page. Free tickets are confirmed at once; paid ones go to checkout. */
export async function registerForEvent(token: string, input: z.output<typeof registerSchema>) {
  const pub = await publicEvent(token);
  if (!pub) throw new AppError("This event isn't taking registrations.");
  if (pub.closed) throw new AppError(pub.closedReason ?? "Registration has closed.");
  return withOrg(pub.orgId, async (tx) => {
    // one registration at a time per event, so the last places can't be sold twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`event:${pub.event.id}`}))`);
    const fresh = await publicEvent(token);
    const type = fresh?.types.find((t) => t.id === input.ticketTypeId);
    if (!fresh || !type) throw new AppError("That ticket isn't available any more.");
    if (type.left !== null && input.quantity > type.left)
      throw new AppError(type.left === 0 ? `"${type.name}" is sold out.` : `Only ${type.left} ${type.name} ticket${type.left === 1 ? "" : "s"} left.`, { quantity: "Choose fewer." });
    const amount = type.priceKobo * input.quantity;
    const settings = await givingSettings(tx, pub.orgId);
    if (amount > 0 && paymentsProvider() === "paystack" && !settings.subaccountCode) throw new PaymentsNotConfigured();
    const phone = normalizeNgPhone(input.phone);
    const matches = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(isNull(members.deletedAt), or(eq(members.emailHash, blindIndex(input.email)!), phone ? eq(members.phoneHash, blindIndex(phone)!) : undefined)))
      .limit(2);
    const reference = amount > 0 ? newReference() : null;
    const [r] = await tx
      .insert(eventRegistrations)
      .values({
        orgId: pub.orgId,
        eventId: pub.event.id,
        ticketTypeId: type.id,
        memberId: matches.length === 1 ? matches[0]!.id : null,
        name: input.name,
        emailEnc: encrypt(input.email),
        emailHash: blindIndex(input.email),
        phoneEnc: encrypt(phone),
        quantity: input.quantity,
        amountKobo: amount,
        status: amount > 0 ? "pending" : "confirmed",
        code: newCode(),
        paymentRef: reference,
        confirmedAt: amount > 0 ? null : new Date(),
      })
      .returning();
    if (reference) {
      await tx.insert(paymentIntents).values({
        reference,
        orgId: pub.orgId,
        purpose: "event",
        targetId: r!.id,
        amountKobo: amount,
        email: input.email,
        provider: paymentsProvider(),
      });
      return { code: r!.code, reference, amountKobo: amount, subaccount: settings.subaccountCode, orgId: pub.orgId, email: input.email };
    }
    await sendTicket(tx, pub.orgId, r!.id);
    return { code: r!.code, reference: null, amountKobo: 0, subaccount: null, orgId: pub.orgId, email: input.email };
  });
}

/** The "Event tickets" fund ticket money goes into, created the first time it's needed. */
async function ticketFund(tx: Tx, orgId: string) {
  const [f] = await tx.select({ id: givingFunds.id }).from(givingFunds).where(eq(givingFunds.code, "EVENTS"));
  if (f) return f.id;
  const [n] = await tx
    .insert(givingFunds)
    .values({ orgId, name: "Event tickets", code: "EVENTS", online: false, color: "c6", sortOrder: 99, description: "Paid event registrations" })
    .returning({ id: givingFunds.id });
  return n!.id;
}

/** Paid registration confirmed by the payment provider: ticket sent, money added to the giving ledger. */
export async function confirmRegistration(tx: Tx, orgId: string, regId: string, r: { feeKobo: number | null; channel: string | null; providerTxId: string | null }) {
  const [reg] = await tx.select().from(eventRegistrations).where(eq(eventRegistrations.id, regId)).for("update");
  if (!reg || reg.status === "confirmed") return;
  await tx.update(eventRegistrations).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(eventRegistrations.id, regId));
  const [e] = await tx.select().from(events).where(eq(events.id, reg.eventId));
  await tx.insert(givingTransactions).values({
    orgId,
    branchId: e!.branchId,
    fundId: await ticketFund(tx, orgId),
    memberId: reg.memberId,
    donorName: reg.name,
    donorEmailEnc: reg.emailEnc,
    donorPhoneEnc: reg.phoneEnc,
    amountKobo: Number(reg.amountKobo),
    feeKobo: r.feeKobo ?? 0,
    channel: "online",
    gatewayChannel: r.channel,
    gatewayRef: r.providerTxId,
    source: "online",
    status: "confirmed",
    givenOn: todayISO(),
    reference: reg.paymentRef!,
    note: `${reg.quantity} × ticket for ${e!.title}`,
    confirmedAt: new Date(),
  });
  await sendTicket(tx, orgId, regId);
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  await audit(tx, systemActor({ id: orgId, name: o!.name }, "Event registration", []), {
    action: "event.paid_registration",
    summary: `${reg.name} paid ${naira(Number(reg.amountKobo))} for ${reg.quantity} ticket${reg.quantity === 1 ? "" : "s"} to ${e!.title}`,
    entityType: "event",
    entityId: reg.eventId,
  });
}

export async function failRegistration(tx: Tx, regId: string) {
  await tx.update(eventRegistrations).set({ status: "failed" }).where(and(eq(eventRegistrations.id, regId), eq(eventRegistrations.status, "pending")));
}

async function sendTicket(tx: Tx, orgId: string, regId: string) {
  const [reg] = await tx
    .select({ r: eventRegistrations, ticket: ticketTypes.name })
    .from(eventRegistrations)
    .innerJoin(ticketTypes, eq(ticketTypes.id, eventRegistrations.ticketTypeId))
    .where(eq(eventRegistrations.id, regId));
  const email = decrypt(reg!.r.emailEnc);
  if (!email) return;
  const [e] = await tx.select().from(events).where(eq(events.id, reg!.r.eventId));
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  const url = `${env().APP_URL}/e/${await eventToken(tx, orgId, reg!.r.eventId)}/t/${reg!.r.code}`;
  await enqueue(
    tx,
    "email.send",
    {
      to: email,
      subject: `Your ticket: ${e!.title}`,
      html: emailLayout({
        church: o!.name,
        preheader: `${formatDate(e!.startsAt, "long")}${e!.venue ? `, ${e!.venue}` : ""}`,
        heading: "You're registered",
        bodyHtml:
          p(`Dear ${reg!.r.name.split(" ")[0]},`) +
          p(`You're registered for ${e!.title}.`) +
          `<table role="presentation" style="font-size:14px;margin:0 0 14px">${[
            ["When", `${formatDate(e!.startsAt, "long")}, ${formatTime(e!.startsAt)}`],
            ...(e!.venue ? [["Where", e!.venue]] : []),
            ["Ticket", `${reg!.r.quantity} × ${reg!.ticket}${Number(reg!.r.amountKobo) ? ` (${naira(Number(reg!.r.amountKobo))} paid)` : ""}`],
            ["Code", reg!.r.code],
          ]
            .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5b6884">${esc(k!)}</td><td style="padding:4px 0;font-weight:600">${esc(v!)}</td></tr>`)
            .join("")}</table>` +
          p("Show the QR code on your ticket at the entrance."),
        button: { label: "Open your ticket", url },
      }),
    },
    { orgId, dedupeKey: `ticket:${regId}` },
  );
}

/** The ticket page: found through the event's public link, then the code within that church. */
export async function publicTicket(token: string, code: string) {
  if (!/^[A-Z2-9]{10}$/.test(code)) return null;
  const [l] = await db.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!l || l.kind !== "event" || !l.targetId) return null;
  return withOrg(l.orgId, async (tx) => {
    const [r] = await tx
      .select({ r: eventRegistrations, ticket: ticketTypes.name })
      .from(eventRegistrations)
      .innerJoin(ticketTypes, eq(ticketTypes.id, eventRegistrations.ticketTypeId))
      .where(and(eq(eventRegistrations.code, code), eq(eventRegistrations.eventId, l.targetId!)));
    if (!r) return null;
    const [e] = await tx.select().from(events).where(eq(events.id, r.r.eventId));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, l.orgId));
    return {
      church: o!.name,
      event: { title: e!.title, startsAt: e!.startsAt, venue: e!.venue, status: e!.status },
      name: r.r.name,
      ticket: r.ticket,
      quantity: r.r.quantity,
      checkedIn: r.r.checkedIn,
      status: r.r.status,
      code: r.r.code,
    };
  });
}

/* ================= check-in ================= */

export const checkinSchema = z.object({ eventId: z.string().uuid(), code: z.string().trim().toUpperCase().min(4).max(40), count: z.coerce.number().int().min(1).max(20).default(1) });

export async function checkInTicket(tx: Tx, ctx: Actor, input: z.output<typeof checkinSchema>) {
  assertCan(ctx, "events.manage", "check people in");
  const code = input.code.replace(/^.*\/T\//, "").replace(/[^A-Z0-9]/g, "").slice(-10);
  const [r] = await tx
    .select({ r: eventRegistrations, ticket: ticketTypes.name })
    .from(eventRegistrations)
    .innerJoin(ticketTypes, eq(ticketTypes.id, eventRegistrations.ticketTypeId))
    .where(eq(eventRegistrations.code, code))
    .for("update");
  if (!r) throw new AppError(`No ticket with code ${code}.`);
  if (r.r.eventId !== input.eventId) throw new AppError(`That ticket is for a different event.`);
  if (r.r.status !== "confirmed") throw new AppError(r.r.status === "pending" ? "This ticket hasn't been paid for." : "This ticket was cancelled.");
  const left = r.r.quantity - r.r.checkedIn;
  if (left <= 0)
    throw new AppError(
      `${r.r.name}'s ${r.r.quantity === 1 ? "ticket was" : `${r.r.quantity} tickets were`} already used${r.r.lastCheckinAt ? ` at ${formatTime(r.r.lastCheckinAt)}` : ""}${r.r.lastCheckinBy ? ` (checked in by ${r.r.lastCheckinBy})` : ""}.`,
    );
  const n = Math.min(left, input.count);
  await tx
    .update(eventRegistrations)
    .set({ checkedIn: r.r.checkedIn + n, lastCheckinAt: new Date(), lastCheckinBy: ctx.user.name })
    .where(eq(eventRegistrations.id, r.r.id));
  await audit(tx, ctx, {
    action: "event.checked_in",
    summary: `Checked in ${n} on ${r.r.name}'s ticket ${code}`,
    entityType: "event",
    entityId: input.eventId,
  });
  return { name: r.r.name, ticket: r.ticket, admitted: n, remaining: left - n, quantity: r.r.quantity };
}

export const deskSchema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid("Choose a ticket."),
  name: z.string().trim().min(3, "Enter their name.").max(120),
  phone: optText(30),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  quantity: z.coerce.number().int().min(1).max(20),
  checkIn: z.boolean().default(true),
});

/** Walk-ins registered at the door. Money taken at the door is counted with the offering, not here. */
export async function registerAtDesk(tx: Tx, ctx: Actor, input: z.output<typeof deskSchema>) {
  assertCan(ctx, "events.manage", "register people");
  const [t] = await tx.select().from(ticketTypes).where(and(eq(ticketTypes.id, input.ticketTypeId), eq(ticketTypes.eventId, input.eventId)));
  if (!t) throw new AppError("Choose a ticket type for this event.");
  const [e] = await tx.select().from(events).where(eq(events.id, input.eventId));
  assertBranch(ctx, e!.branchId);
  const phone = normalizeNgPhone(input.phone);
  const [r] = await tx
    .insert(eventRegistrations)
    .values({
      orgId: ctx.org.id,
      eventId: input.eventId,
      ticketTypeId: t.id,
      name: input.name,
      emailEnc: encrypt(input.email),
      emailHash: blindIndex(input.email),
      phoneEnc: encrypt(phone),
      quantity: input.quantity,
      amountKobo: Number(t.priceKobo) * input.quantity,
      status: "confirmed",
      code: newCode(),
      source: "desk",
      confirmedAt: new Date(),
      checkedIn: input.checkIn ? input.quantity : 0,
      lastCheckinAt: input.checkIn ? new Date() : null,
      lastCheckinBy: input.checkIn ? ctx.user.name : null,
    })
    .returning();
  await audit(tx, ctx, { action: "event.desk_registration", summary: `Registered ${input.name} (${input.quantity}) at the door for ${e!.title}`, entityType: "event", entityId: input.eventId });
  if (input.email) await sendTicket(tx, ctx.org.id, r!.id);
  return r!.code;
}

export async function cancelRegistration(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "events.manage", "cancel registrations");
  const [r] = await tx.select().from(eventRegistrations).where(eq(eventRegistrations.id, id)).for("update");
  if (!r) throw notFound("That registration");
  if (r.status === "cancelled") return;
  await tx.update(eventRegistrations).set({ status: "cancelled" }).where(eq(eventRegistrations.id, id));
  await audit(tx, ctx, {
    action: "event.registration_cancelled",
    summary: `Cancelled ${r.name}'s registration${Number(r.amountKobo) ? ` (${naira(Number(r.amountKobo))} paid; refund separately)` : ""}`,
    entityType: "event",
    entityId: r.eventId,
  });
}

export async function exportRegistrations(tx: Tx, ctx: Actor, eventId: string) {
  const rows = await listRegistrations(tx, ctx, eventId, { status: "all" });
  await audit(tx, ctx, { action: "event.exported", summary: `Exported ${rows.length} registrations`, entityType: "event", entityId: eventId });
  return rows.map((r) => ({
    Name: r.name,
    Email: r.email ?? "",
    Phone: r.phone ?? "",
    Ticket: r.ticket,
    Quantity: r.quantity,
    "Paid (₦)": r.amountKobo / 100,
    Status: r.status,
    "Checked in": r.checkedIn,
    Code: r.code,
    Source: r.source === "desk" ? "At the door" : "Online",
    Registered: formatDateTime(r.createdAt),
    Member: r.memberId ? "Yes" : "",
  }));
}

