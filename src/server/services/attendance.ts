import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { attendance, branches, members, publicLinks, serviceTemplates, services, SERVICE_KINDS } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, randomToken } from "../crypto";
import { AppError, notFound } from "../errors";
import { normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";

export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  sunday: "Sunday service",
  midweek: "Midweek service",
  special: "Special service",
  vigil: "Vigil",
  youth: "Youth service",
  children: "Children's service",
  other: "Other",
};

/** Lagos is UTC+1 all year (no daylight saving), so local wall-clock time converts with a fixed offset. */
export function lagosToUtc(date: string, time: string) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(h! - 1, m ?? 0, 0, 0);
  return d;
}
export function lagosToday(now = new Date()) {
  return new Date(now.getTime() + 3600_000).toISOString().slice(0, 10);
}

/* ---------- templates ---------- */

export async function listTemplates(tx: Tx, ctx: Actor) {
  return tx
    .select()
    .from(serviceTemplates)
    .where(and(isNull(serviceTemplates.archivedAt), branchScope(ctx, serviceTemplates.branchId)))
    .orderBy(asc(serviceTemplates.weekday), asc(serviceTemplates.startTime));
}

export async function saveTemplate(
  tx: Tx,
  ctx: Actor,
  input: {
    id?: string;
    branchId: string;
    name: string;
    kind: ServiceKind;
    weekday: number;
    startTime: string;
    durationMin: number;
  },
) {
  assertCan(ctx, "attendance.record", "set up services");
  assertBranch(ctx, input.branchId);
  const values = { ...input, name: input.name.trim() };
  delete (values as { id?: string }).id;
  if (input.id) {
    await tx.update(serviceTemplates).set(values).where(eq(serviceTemplates.id, input.id));
    return input.id;
  }
  const [t] = await tx
    .insert(serviceTemplates)
    .values({ ...values, orgId: ctx.org.id })
    .returning({ id: serviceTemplates.id });
  await audit(tx, ctx, {
    action: "service_template.created",
    summary: `Added regular service ${values.name}`,
    entityType: "service_template",
    entityId: t!.id,
  });
  return t!.id;
}

export async function archiveTemplate(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "attendance.record", "set up services");
  await tx.update(serviceTemplates).set({ archivedAt: new Date() }).where(eq(serviceTemplates.id, id));
}

/* ---------- services ---------- */

export async function createService(
  tx: Tx,
  ctx: Actor,
  input: {
    branchId: string;
    name: string;
    kind: ServiceKind;
    date: string;
    startTime: string;
    durationMin: number;
    templateId?: string | null;
  },
) {
  assertCan(ctx, "attendance.record", "start services");
  assertBranch(ctx, input.branchId);
  const startsAt = lagosToUtc(input.date, input.startTime);
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  if (input.templateId) {
    const [existing] = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.templateId, input.templateId), eq(services.date, input.date)));
    if (existing) return existing.id;
  }
  const [s] = await tx
    .insert(services)
    .values({
      orgId: ctx.org.id,
      branchId: input.branchId,
      templateId: input.templateId ?? null,
      name: input.name.trim(),
      kind: input.kind,
      date: input.date,
      startsAt,
      endsAt,
      createdBy: ctx.user.id,
    })
    .returning({ id: services.id });
  await tx.insert(publicLinks).values({
    token: randomToken(18),
    orgId: ctx.org.id,
    kind: "service_checkin",
    targetId: s!.id,
    // self check-in works from two hours before until six hours after the start
    expiresAt: new Date(endsAt.getTime() + 6 * 3600_000),
  });
  await audit(tx, ctx, {
    action: "service.created",
    summary: `Started ${input.name} on ${input.date}`,
    entityType: "service",
    entityId: s!.id,
  });
  return s!.id;
}

/** Services for the regular templates on a date (idempotent): "Start today's services". */
export async function startFromTemplates(tx: Tx, ctx: Actor, date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const due = (await listTemplates(tx, ctx)).filter((t) => t.weekday === weekday);
  const ids = [];
  for (const t of due)
    ids.push(
      await createService(tx, ctx, {
        branchId: t.branchId,
        name: t.name,
        kind: t.kind,
        date,
        startTime: t.startTime.slice(0, 5),
        durationMin: t.durationMin,
        templateId: t.id,
      }),
    );
  return ids;
}

const presentCount = sql<number>`(select count(*)::int from ${attendance} a where a.service_id = ${services.id})`;

export async function listServices(tx: Tx, ctx: Actor, opts: { from?: string; to?: string; limit?: number } = {}) {
  // people who check others in need the list of services too
  if (!ctx.can("attendance.record")) assertCan(ctx, "attendance.read", "see attendance");
  return tx
    .select({
      id: services.id,
      name: services.name,
      kind: services.kind,
      date: services.date,
      startsAt: services.startsAt,
      status: services.status,
      branchId: services.branchId,
      branchName: branches.name,
      men: services.men,
      women: services.women,
      children: services.children,
      online: services.online,
      firstTimersCount: services.firstTimersCount,
      present: presentCount,
    })
    .from(services)
    .innerJoin(branches, eq(branches.id, services.branchId))
    .where(
      and(
        branchScope(ctx, services.branchId),
        opts.from ? gte(services.date, opts.from) : undefined,
        opts.to ? lte(services.date, opts.to) : undefined,
      ),
    )
    .orderBy(desc(services.startsAt))
    .limit(opts.limit ?? 50);
}

export async function getService(tx: Tx, ctx: Actor, id: string) {
  if (!ctx.can("attendance.read") && !ctx.can("attendance.record")) assertCan(ctx, "attendance.read");
  const [s] = await tx
    .select({ s: services, branchName: branches.name })
    .from(services)
    .innerJoin(branches, eq(branches.id, services.branchId))
    .where(eq(services.id, id));
  if (!s) throw notFound("That service");
  assertBranch(ctx, s.s.branchId);
  const [link] = await tx
    .select({ token: publicLinks.token })
    .from(publicLinks)
    .where(and(eq(publicLinks.targetId, id), eq(publicLinks.kind, "service_checkin"), isNull(publicLinks.revokedAt)));
  const present = await tx
    .select({
      id: members.id,
      title: members.title,
      firstName: members.firstName,
      lastName: members.lastName,
      memberNo: members.memberNo,
      stage: members.stage,
      method: attendance.method,
      at: attendance.checkedInAt,
    })
    .from(attendance)
    .innerJoin(members, eq(members.id, attendance.memberId))
    .where(eq(attendance.serviceId, id))
    .orderBy(desc(attendance.checkedInAt));
  const headcount = (s.s.men ?? 0) + (s.s.women ?? 0) + (s.s.children ?? 0) || null;
  return { ...s.s, branchName: s.branchName, checkinToken: link?.token ?? null, present, headcount };
}

/* ---------- check-in ---------- */

/**
 * Marks a member present. Repeat check-ins are ignored. Moves people along automatically:
 * a first timer who comes back on another day becomes a second timer, and a second timer
 * with four visits becomes a regular.
 */
export async function checkIn(
  tx: Tx,
  ctx: Actor | null,
  serviceId: string,
  memberId: string,
  method: "self_qr" | "staff",
) {
  if (ctx) assertCan(ctx, "attendance.record", "check people in");
  const [s] = await tx.select().from(services).where(eq(services.id, serviceId));
  if (!s) throw notFound("That service");
  if (ctx) assertBranch(ctx, s.branchId);
  if (s.status === "closed") throw new AppError("This service has been closed. Reopen it to check people in.");
  const [m] = await tx
    .select({ id: members.id, stage: members.stage, firstName: members.firstName, deletedAt: members.deletedAt })
    .from(members)
    .where(eq(members.id, memberId));
  if (!m || m.deletedAt) throw notFound("That member");
  const inserted = await tx
    .insert(attendance)
    .values({ orgId: s.orgId, serviceId, memberId, method, checkedInBy: ctx?.user.id ?? null })
    .onConflictDoNothing()
    .returning({ memberId: attendance.memberId });
  if (!inserted.length) return { already: true, firstName: m.firstName };

  if (m.stage === "first_timer" || m.stage === "second_timer" || m.stage === "visitor") {
    const [{ days } = { days: 0 }] = await tx
      .select({ days: sql<number>`count(distinct ${services.date})::int` })
      .from(attendance)
      .innerJoin(services, eq(services.id, attendance.serviceId))
      .where(eq(attendance.memberId, memberId));
    const next =
      m.stage === "visitor"
        ? "first_timer"
        : m.stage === "first_timer" && days >= 2
          ? "second_timer"
          : m.stage === "second_timer" && days >= 4
            ? "regular"
            : null;
    if (next) await tx.update(members).set({ stage: next }).where(eq(members.id, memberId));
  }
  return { already: false, firstName: m.firstName };
}

export async function undoCheckIn(tx: Tx, ctx: Actor, serviceId: string, memberId: string) {
  assertCan(ctx, "attendance.record", "change attendance");
  await tx.delete(attendance).where(and(eq(attendance.serviceId, serviceId), eq(attendance.memberId, memberId)));
}

export async function recordHeadcount(
  tx: Tx,
  ctx: Actor,
  serviceId: string,
  c: {
    men: number;
    women: number;
    children: number;
    online?: number | null;
    firstTimersCount?: number | null;
    countNotes?: string | null;
  },
) {
  assertCan(ctx, "attendance.record", "record headcounts");
  const [s] = await tx.select().from(services).where(eq(services.id, serviceId));
  if (!s) throw notFound("That service");
  assertBranch(ctx, s.branchId);
  await tx
    .update(services)
    .set({ ...c, countedBy: ctx.user.id, countedAt: new Date() })
    .where(eq(services.id, serviceId));
  await audit(tx, ctx, {
    action: "service.headcount",
    summary: `Headcount for ${s.name} (${s.date}): ${c.men + c.women + c.children} in church${c.online ? `, ${c.online} online` : ""}`,
    entityType: "service",
    entityId: serviceId,
    before: { men: s.men, women: s.women, children: s.children, online: s.online },
    after: c,
  });
}

export async function setServiceStatus(tx: Tx, ctx: Actor, serviceId: string, status: "open" | "closed") {
  assertCan(ctx, "attendance.record", "close services");
  const [s] = await tx.select().from(services).where(eq(services.id, serviceId));
  if (!s) throw notFound("That service");
  await tx.update(services).set({ status }).where(eq(services.id, serviceId));
  await audit(tx, ctx, {
    action: status === "closed" ? "service.closed" : "service.reopened",
    summary: `${status === "closed" ? "Closed" : "Reopened"} ${s.name} (${s.date})`,
    entityType: "service",
    entityId: serviceId,
  });
}

/* ---------- self check-in (public) ---------- */

export async function readCheckinLink(tx: Tx, token: string) {
  const [link] = await tx.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!link || link.kind !== "service_checkin" || link.revokedAt || !link.targetId) return null;
  return link;
}

/** For the public check-in page, after withOrg(link.orgId). */
export async function serviceForSelfCheckin(tx: Tx, serviceId: string, now = new Date()) {
  const [s] = await tx
    .select({ s: services, branchName: branches.name })
    .from(services)
    .innerJoin(branches, eq(branches.id, services.branchId))
    .where(eq(services.id, serviceId));
  if (!s) return null;
  const opensAt = new Date(s.s.startsAt.getTime() - 2 * 3600_000);
  const closesAt = new Date(s.s.endsAt.getTime() + 6 * 3600_000);
  const state = s.s.status === "closed" || now > closesAt ? "closed" : now < opensAt ? "early" : "open";
  return {
    id: s.s.id,
    name: s.s.name,
    date: s.s.date,
    startsAt: s.s.startsAt,
    branchName: s.branchName,
    state,
    opensAt,
  };
}

export async function selfCheckIn(tx: Tx, serviceId: string, phone: string) {
  const e164 = normalizeNgPhone(phone);
  if (!e164)
    throw new AppError("Enter your phone number the way it is on your church record, e.g. 0803 123 4567.", {
      phone: "Enter a valid number.",
    });
  const s = await serviceForSelfCheckin(tx, serviceId);
  if (!s || s.state !== "open") throw new AppError("Check-in for this service isn't open right now.");
  const found = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.phoneHash, blindIndex(e164)!), isNull(members.deletedAt)))
    .limit(2);
  if (!found.length) return { found: false as const };
  // several family members may share one number; check in the first match and let ushers handle the rest
  const r = await checkIn(tx, null, serviceId, found[0]!.id, "self_qr");
  return { found: true as const, ...r };
}

/* ---------- people and trends ---------- */

/** Members who came regularly (2+ of the previous 8 weeks) but missed the last 3 Sundays. */
export async function absentees(tx: Tx, ctx: Pick<Actor, "branchIds">, today = lagosToday()) {
  const rows = await tx.execute<{ id: string; first_name: string; last_name: string; last_seen: string | null }>(sql`
    with sundays as (
      select id, date from ${services}
      where kind = 'sunday' and date <= ${today}::date and date > ${today}::date - interval '77 days'
    ),
    recent as (select id from sundays where date > ${today}::date - interval '21 days'),
    earlier as (select id from sundays where date <= ${today}::date - interval '21 days')
    select m.id, m.first_name, m.last_name,
      (select max(s.date)::text from ${attendance} a join ${services} s on s.id = a.service_id where a.member_id = m.id) as last_seen
    from ${members} m
    where m.deleted_at is null and m.status = 'active'
      ${ctx.branchIds.length ? sql`and m.branch_id = any(${ctx.branchIds})` : sql``}
      and (select count(*) from recent) >= 2
      and (select count(*) from ${attendance} a where a.member_id = m.id and a.service_id in (select id from earlier)) >= 2
      and not exists (select 1 from ${attendance} a where a.member_id = m.id and a.service_id in (select id from recent))
    order by last_seen desc nulls last
    limit 500`);
  return rows as unknown as { id: string; first_name: string; last_name: string; last_seen: string | null }[];
}

export async function memberAttendance(tx: Tx, memberId: string) {
  const rows = await tx
    .select({ id: services.id, name: services.name, date: services.date })
    .from(attendance)
    .innerJoin(services, eq(services.id, attendance.serviceId))
    .where(eq(attendance.memberId, memberId))
    .orderBy(desc(services.date))
    .limit(12);
  const [{ total } = { total: 0 }] = await tx
    .select({ total: count() })
    .from(attendance)
    .where(eq(attendance.memberId, memberId));
  return { recent: rows, total: Number(total) };
}

/** Weekly totals for charts: Sunday attendance (headcount where recorded, otherwise check-ins). */
export async function attendanceTrend(tx: Tx, ctx: Actor, weeks = 12) {
  const rows = await tx
    .select({
      date: services.date,
      name: services.name,
      checkedIn: presentCount,
      headcount: sql<
        number | null
      >`nullif(coalesce(${services.men},0) + coalesce(${services.women},0) + coalesce(${services.children},0), 0)`,
      online: services.online,
    })
    .from(services)
    .where(
      and(
        eq(services.kind, "sunday"),
        branchScope(ctx, services.branchId),
        gte(services.date, sql`current_date - ${weeks * 7}::int`),
      ),
    )
    .orderBy(asc(services.date));
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r.headcount ?? r.checkedIn);
    byDate.set(String(r.date), (byDate.get(String(r.date)) ?? 0) + v);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

export async function presentMemberIds(tx: Tx, serviceId: string, memberIds: string[]) {
  if (!memberIds.length) return new Set<string>();
  const rows = await tx
    .select({ id: attendance.memberId })
    .from(attendance)
    .where(and(eq(attendance.serviceId, serviceId), inArray(attendance.memberId, memberIds)));
  return new Set(rows.map((r) => r.id));
}

/** Names of today's services, for linking a children's check-in to a service. Any staff role may see these. */
export async function todaysServiceOptions(tx: Tx, ctx: Pick<Actor, "branchIds">) {
  return tx
    .select({ id: services.id, name: services.name, startsAt: services.startsAt })
    .from(services)
    .where(and(eq(services.date, lagosToday()), eq(services.status, "open"), branchScope(ctx, services.branchId)))
    .orderBy(asc(services.startsAt));
}
