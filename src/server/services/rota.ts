import { createHmac } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withOrg, type Tx } from "../db";
import { groupMembers, groups, members, organisations, rotaSlots } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan, systemActor } from "../auth/context";
import { audit } from "../audit";
import { decrypt, safeEqual } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, p } from "../emails/layout";
import { env } from "../env";
import { formatDate, todayISO } from "@/lib/format";
import { assertBranch, branchScope } from "./scope";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

/** The next n Sundays from a date (inclusive), as YYYY-MM-DD. */
export function sundays(from: string, n: number) {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return Array.from({ length: n }, (_, i) => new Date(d.getTime() + i * 7 * 86400_000).toISOString().slice(0, 10));
}

/* ================= reading ================= */

export async function rotaRange(tx: Tx, ctx: Actor, opts: { from: string; to: string; groupId?: string }) {
  assertCan(ctx, "volunteers.manage", "manage the rota");
  const slots = await tx
    .select({
      s: rotaSlots,
      firstName: members.firstName,
      lastName: members.lastName,
      groupName: groups.name,
    })
    .from(rotaSlots)
    .innerJoin(groups, eq(groups.id, rotaSlots.groupId))
    .leftJoin(members, eq(members.id, rotaSlots.memberId))
    .where(
      and(
        gte(rotaSlots.date, opts.from),
        lte(rotaSlots.date, opts.to),
        opts.groupId ? eq(rotaSlots.groupId, opts.groupId) : undefined,
        branchScope(ctx, rotaSlots.branchId),
      ),
    )
    .orderBy(asc(rotaSlots.date), asc(groups.name), asc(rotaSlots.position));
  return slots.map((r) => ({
    ...r.s,
    date: String(r.s.date),
    memberName: r.firstName ? `${r.firstName} ${r.lastName}` : null,
    groupName: r.groupName,
  }));
}
export type RotaSlot = Awaited<ReturnType<typeof rotaRange>>[number];

export async function rotaGroups(tx: Tx, ctx: Actor) {
  assertCan(ctx, "volunteers.manage", "manage the rota");
  const gs = await tx
    .select({ id: groups.id, name: groups.name, kind: groups.kind, branchId: groups.branchId })
    .from(groups)
    .where(and(isNull(groups.archivedAt), ne(groups.kind, "cell"), branchScope(ctx, groups.branchId)))
    .orderBy(asc(groups.name));
  const people = gs.length
    ? await tx
        .select({ groupId: groupMembers.groupId, id: members.id, firstName: members.firstName, lastName: members.lastName })
        .from(groupMembers)
        .innerJoin(members, eq(members.id, groupMembers.memberId))
        .where(and(inArray(groupMembers.groupId, gs.map((g) => g.id)), isNull(members.deletedAt), eq(members.status, "active")))
        .orderBy(asc(members.firstName))
    : [];
  return gs.map((g) => ({ ...g, members: people.filter((m) => m.groupId === g.id).map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` })) }));
}

/* ================= changing the rota ================= */

async function loadGroup(tx: Tx, ctx: Actor, groupId: string) {
  const [g] = await tx.select().from(groups).where(eq(groups.id, groupId));
  if (!g) throw notFound("That department");
  assertBranch(ctx, g.branchId);
  return g;
}

async function assertInGroup(tx: Tx, groupId: string, memberId: string) {
  const [m] = await tx
    .select({ id: groupMembers.memberId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.memberId, memberId)));
  if (!m) throw new AppError("That person isn't in this department. Add them to the department first.");
}

export const slotSchema = z.object({
  groupId: z.string().uuid("Choose a department."),
  date: isoDate,
  serviceLabel: z.string().trim().min(2).max(60).default("Sunday service"),
  position: z.string().trim().min(2, "Name the position, e.g. Main door.").max(60),
  memberId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => v || null),
});

export async function addSlot(tx: Tx, ctx: Actor, input: z.output<typeof slotSchema>) {
  assertCan(ctx, "volunteers.manage", "manage the rota");
  const g = await loadGroup(tx, ctx, input.groupId);
  if (input.memberId) await assertInGroup(tx, g.id, input.memberId);
  const [s] = await tx
    .insert(rotaSlots)
    .values({
      orgId: ctx.org.id,
      branchId: g.branchId,
      groupId: g.id,
      date: input.date,
      serviceLabel: input.serviceLabel,
      position: input.position,
      memberId: input.memberId,
      status: input.memberId ? "assigned" : "open",
      createdBy: ctx.user.id,
    })
    .returning({ id: rotaSlots.id });
  if (input.memberId) await notifyAssigned(tx, ctx.org.id, [s!.id]);
  await audit(tx, ctx, { action: "rota.slot_added", summary: `Added ${input.position} for ${g.name} on ${formatDate(input.date)}`, entityType: "rota", entityId: s!.id });
  return s!.id;
}

export async function assignSlot(tx: Tx, ctx: Actor, input: { id: string; memberId: string | null }) {
  assertCan(ctx, "volunteers.manage", "manage the rota");
  const [s] = await tx.select().from(rotaSlots).where(eq(rotaSlots.id, input.id)).for("update");
  if (!s) throw notFound("That slot");
  assertBranch(ctx, s.branchId);
  if (input.memberId) {
    await assertInGroup(tx, s.groupId, input.memberId);
    const [clash] = await tx
      .select({ position: rotaSlots.position })
      .from(rotaSlots)
      .where(and(eq(rotaSlots.date, s.date), eq(rotaSlots.memberId, input.memberId), eq(rotaSlots.serviceLabel, s.serviceLabel), ne(rotaSlots.id, s.id)));
    if (clash) throw new AppError(`They're already serving as ${clash.position} at that service.`);
  }
  await tx
    .update(rotaSlots)
    .set({ memberId: input.memberId, status: input.memberId ? "assigned" : "open", declineReason: null, respondedAt: null, remindedAt: null })
    .where(eq(rotaSlots.id, s.id));
  if (input.memberId) await notifyAssigned(tx, ctx.org.id, [s.id]);
  await audit(tx, ctx, {
    action: "rota.assigned",
    summary: `${input.memberId ? "Assigned" : "Cleared"} ${s.position} on ${formatDate(String(s.date))}`,
    entityType: "rota",
    entityId: s.id,
  });
}

export async function removeSlot(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "volunteers.manage", "manage the rota");
  const [s] = await tx.select().from(rotaSlots).where(eq(rotaSlots.id, id));
  if (!s) throw notFound("That slot");
  assertBranch(ctx, s.branchId);
  await tx.delete(rotaSlots).where(eq(rotaSlots.id, id));
  await audit(tx, ctx, { action: "rota.slot_removed", summary: `Removed ${s.position} on ${formatDate(String(s.date))}`, entityType: "rota", entityId: id });
}

export const fillSchema = z.object({
  groupId: z.string().uuid("Choose a department."),
  dates: z.array(isoDate).min(1, "Choose at least one date.").max(12),
  serviceLabel: z.string().trim().min(2).max(60).default("Sunday service"),
  positions: z.array(z.string().trim().min(2).max(60)).min(1, "Add at least one position.").max(30),
  notify: z.boolean().default(true),
});

/**
 * Fills the rota fairly: for each date and position, the department member who has served least recently
 * (and isn't already serving that day, and didn't decline that date) gets it. Existing slots are left alone.
 */
export async function autoFill(tx: Tx, ctx: Actor, input: z.output<typeof fillSchema>) {
  assertCan(ctx, "volunteers.manage", "manage the rota");
  const g = await loadGroup(tx, ctx, input.groupId);
  const people = await tx
    .select({ id: members.id })
    .from(groupMembers)
    .innerJoin(members, eq(members.id, groupMembers.memberId))
    .where(and(eq(groupMembers.groupId, g.id), isNull(members.deletedAt), eq(members.status, "active")));
  if (!people.length) throw new AppError(`${g.name} has no members yet. Add people to the department first.`);
  const history = await tx
    .select({ memberId: rotaSlots.memberId, last: sql<string>`max(${rotaSlots.date})::text`, n: sql<number>`count(*)::int` })
    .from(rotaSlots)
    .where(and(eq(rotaSlots.groupId, g.id), sql`${rotaSlots.memberId} is not null`, ne(rotaSlots.status, "declined")))
    .groupBy(rotaSlots.memberId);
  const load = new Map(people.map((x) => [x.id, { last: "0000-00-00", n: 0 }]));
  for (const h of history) if (h.memberId && load.has(h.memberId)) load.set(h.memberId, { last: h.last, n: h.n });
  const existing = await tx
    .select()
    .from(rotaSlots)
    .where(and(inArray(rotaSlots.date, input.dates), eq(rotaSlots.serviceLabel, input.serviceLabel)));
  const created: string[] = [];
  let unfilled = 0;
  for (const date of [...input.dates].sort()) {
    const busy = new Set(existing.filter((e) => String(e.date) === date && e.memberId).map((e) => e.memberId!));
    const declined = new Set(existing.filter((e) => String(e.date) === date && e.status === "declined" && e.memberId).map((e) => e.memberId!));
    for (const position of input.positions) {
      if (existing.some((e) => String(e.date) === date && e.groupId === g.id && e.position === position)) continue;
      const pick = people
        .filter((x) => !busy.has(x.id) && !declined.has(x.id))
        .sort((a, b) => {
          const la = load.get(a.id)!;
          const lb = load.get(b.id)!;
          return la.last.localeCompare(lb.last) || la.n - lb.n || a.id.localeCompare(b.id);
        })[0];
      const [s] = await tx
        .insert(rotaSlots)
        .values({
          orgId: ctx.org.id,
          branchId: g.branchId,
          groupId: g.id,
          date,
          serviceLabel: input.serviceLabel,
          position,
          memberId: pick?.id ?? null,
          status: pick ? "assigned" : "open",
          createdBy: ctx.user.id,
        })
        .returning({ id: rotaSlots.id });
      if (pick) {
        busy.add(pick.id);
        const l = load.get(pick.id)!;
        load.set(pick.id, { last: date, n: l.n + 1 });
        created.push(s!.id);
      } else unfilled++;
    }
  }
  if (input.notify && created.length) await notifyAssigned(tx, ctx.org.id, created);
  await audit(tx, ctx, {
    action: "rota.filled",
    summary: `Filled the ${g.name} rota for ${input.dates.length} date${input.dates.length === 1 ? "" : "s"}: ${created.length} assigned${unfilled ? `, ${unfilled} left open (not enough people)` : ""}`,
    entityType: "rota",
    entityId: g.id,
  });
  return { assigned: created.length, open: unfilled };
}

/* ================= telling volunteers and hearing back ================= */

const rotaKey = () => createHmac("sha256", Buffer.from(env().BLIND_INDEX_KEY, "base64")).update("rota-v1").digest();

export function slotToken(orgId: string, slotId: string) {
  const payload = `${orgId}.${slotId}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", rotaKey()).update(payload).digest("base64url").slice(0, 22)}`;
}

function readToken(token: string) {
  const [a, sig] = token.split(".");
  if (!a || !sig) return null;
  const payload = Buffer.from(a, "base64url").toString("utf8");
  if (!safeEqual(sig, createHmac("sha256", rotaKey()).update(payload).digest("base64url").slice(0, 22))) return null;
  const [orgId, slotId] = payload.split(".");
  return orgId && slotId ? { orgId, slotId } : null;
}

async function notifyAssigned(tx: Tx, orgId: string, slotIds: string[]) {
  if (!slotIds.length) return;
  const rows = await tx
    .select({ s: rotaSlots, groupName: groups.name, firstName: members.firstName, emailEnc: members.emailEnc, phoneEnc: members.phoneEnc })
    .from(rotaSlots)
    .innerJoin(groups, eq(groups.id, rotaSlots.groupId))
    .innerJoin(members, eq(members.id, rotaSlots.memberId))
    .where(inArray(rotaSlots.id, slotIds));
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  for (const r of rows) {
    const url = `${env().APP_URL}/r/${slotToken(orgId, r.s.id)}`;
    const when = `${formatDate(String(r.s.date), "long")} (${r.s.serviceLabel})`;
    const email = decrypt(r.emailEnc);
    const phone = decrypt(r.phoneEnc);
    if (email)
      await enqueue(
        tx,
        "email.send",
        {
          to: email,
          subject: `You're serving: ${r.s.position}, ${formatDate(String(r.s.date))}`,
          html: emailLayout({
            church: o!.name,
            heading: "You're on the rota",
            bodyHtml: p(`Dear ${r.firstName},`) + p(`${r.groupName} has you down as ${r.s.position} on ${when}.`) + p("Please confirm, or let us know if you can't make it so someone else can cover."),
            button: { label: "Confirm or decline", url },
          }),
        },
        { orgId, dedupeKey: `rota-assign:${r.s.id}:${r.s.memberId}:${Date.now()}` },
      );
    else if (phone) {
      const { sendDirect } = await import("./messaging");
      await sendDirect(tx, orgId, {
        channel: "sms",
        to: phone,
        memberId: r.s.memberId,
        purpose: "rota",
        body: `${o!.name}: you're serving as ${r.s.position} (${r.groupName}) on ${formatDate(String(r.s.date))}. Confirm or decline: ${url}`,
      });
    }
  }
}

export async function slotForToken(token: string) {
  const t = readToken(token);
  if (!t) return null;
  return withOrg(t.orgId, async (tx) => {
    const [r] = await tx
      .select({ s: rotaSlots, groupName: groups.name, firstName: members.firstName })
      .from(rotaSlots)
      .innerJoin(groups, eq(groups.id, rotaSlots.groupId))
      .leftJoin(members, eq(members.id, rotaSlots.memberId))
      .where(eq(rotaSlots.id, t.slotId));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, t.orgId));
    if (!r || !o) return null;
    return { ...t, church: o.name, slot: { ...r.s, date: String(r.s.date) }, groupName: r.groupName, firstName: r.firstName };
  });
}

export const respondSchema = z.object({
  token: z.string().min(10).max(300),
  answer: z.enum(["confirm", "decline"]),
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

/** The volunteer confirms or declines from the link. A decline frees the slot and tells the coordinators. */
export async function respondToSlot(input: z.output<typeof respondSchema>) {
  const t = readToken(input.token);
  if (!t) throw new AppError("This link isn't valid. Ask your head of department.");
  return withOrg(t.orgId, async (tx) => {
    const [s] = await tx.select().from(rotaSlots).where(eq(rotaSlots.id, t.slotId)).for("update");
    if (!s || !s.memberId) throw new AppError("This slot has been changed. Ask your head of department.");
    if (String(s.date) < todayISO()) throw new AppError("This service has already happened.");
    const [m] = await tx.select({ firstName: members.firstName, lastName: members.lastName }).from(members).where(eq(members.id, s.memberId));
    await tx
      .update(rotaSlots)
      .set({ status: input.answer === "confirm" ? "confirmed" : "declined", declineReason: input.reason, respondedAt: new Date() })
      .where(eq(rotaSlots.id, s.id));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, t.orgId));
    await audit(tx, systemActor({ id: t.orgId, name: o!.name }, `${m?.firstName} ${m?.lastName}`, []), {
      action: input.answer === "confirm" ? "rota.confirmed" : "rota.declined",
      summary: `${m?.firstName} ${m?.lastName} ${input.answer === "confirm" ? "confirmed" : "can't make"} ${s.position} on ${formatDate(String(s.date))}${input.reason ? `: ${input.reason}` : ""}`,
      entityType: "rota",
      entityId: s.id,
    });
    if (input.answer === "decline") {
      const [g] = await tx.select({ name: groups.name }).from(groups).where(eq(groups.id, s.groupId));
      const managers = await tx.execute<{ email: string }>(sql`
        select u.email from memberships ms join users u on u.id = ms.user_id join roles r on r.id = ms.role_id
        where ms.org_id = ${t.orgId} and ms.status = 'active' and 'volunteers.manage' = any(r.permissions)`);
      for (const mg of managers)
        await enqueue(
          tx,
          "email.send",
          {
            to: mg.email,
            subject: `Cover needed: ${s.position}, ${formatDate(String(s.date))}`,
            html: emailLayout({
              church: o!.name,
              heading: "Someone can't make it",
              bodyHtml: p(`${m?.firstName} ${m?.lastName} can't serve as ${s.position} (${g?.name}) on ${formatDate(String(s.date), "long")}.${input.reason ? ` They said: "${input.reason}"` : ""}`),
              button: { label: "Find cover", url: `${env().APP_URL}/rota?from=${String(s.date)}` },
            }),
          },
          { orgId: t.orgId, dedupeKey: `rota-decline:${s.id}:${Date.now()}` },
        );
    }
    return input.answer;
  });
}

/** Evening before: a reminder to everyone serving tomorrow who hasn't been reminded. */
export async function sendRotaReminders(orgId: string, tomorrow: string) {
  return withOrg(orgId, async (tx) => {
    const due = await tx
      .select({ id: rotaSlots.id })
      .from(rotaSlots)
      .where(and(eq(rotaSlots.date, tomorrow), inArray(rotaSlots.status, ["assigned", "confirmed"]), isNull(rotaSlots.remindedAt)));
    if (!due.length) return 0;
    const rows = await tx
      .select({ s: rotaSlots, groupName: groups.name, firstName: members.firstName, emailEnc: members.emailEnc, phoneEnc: members.phoneEnc })
      .from(rotaSlots)
      .innerJoin(groups, eq(groups.id, rotaSlots.groupId))
      .innerJoin(members, eq(members.id, rotaSlots.memberId))
      .where(inArray(rotaSlots.id, due.map((d) => d.id)));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
    const { sendDirect } = await import("./messaging");
    for (const r of rows) {
      const phone = decrypt(r.phoneEnc);
      const email = decrypt(r.emailEnc);
      const text = `${o!.name}: reminder, you're serving as ${r.s.position} (${r.groupName}) tomorrow, ${formatDate(tomorrow, "week")}. God bless you.`;
      if (phone) await sendDirect(tx, orgId, { channel: "sms", to: phone, memberId: r.s.memberId, purpose: "rota", body: text });
      else if (email)
        await enqueue(
          tx,
          "email.send",
          { to: email, subject: `Tomorrow: ${r.s.position}`, html: emailLayout({ church: o!.name, heading: "See you tomorrow", bodyHtml: p(text) }) },
          { orgId, dedupeKey: `rota-remind:${r.s.id}` },
        );
      await tx.update(rotaSlots).set({ remindedAt: new Date() }).where(eq(rotaSlots.id, r.s.id));
    }
    return rows.length;
  });
}

/** Slots for the signed-in staff member's own member record, if their email matches one. */
export async function upcomingFor(tx: Tx, memberId: string) {
  const rows = await tx
    .select({ s: rotaSlots, groupName: groups.name })
    .from(rotaSlots)
    .innerJoin(groups, eq(groups.id, rotaSlots.groupId))
    .where(and(eq(rotaSlots.memberId, memberId), gte(rotaSlots.date, todayISO())))
    .orderBy(asc(rotaSlots.date))
    .limit(10);
  return rows.map((r) => ({ ...r.s, date: String(r.s.date), groupName: r.groupName }));
}

