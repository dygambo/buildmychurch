import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, exists, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import {
  branches,
  files,
  groups,
  memberships,
  members,
  messages,
  organisations,
  publicLinks,
  roles,
  scheduleAssignments,
  scheduleItems,
  scheduleNotifications,
  scheduleTemplates,
  scheduleVersions,
  serviceSchedules,
  users,
  SCHEDULE_TYPES,
  type ScheduleSnapshot,
  type ScheduleTemplateBody,
  type ScheduleType,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan, systemActor } from "../auth/context";
import { audit } from "../audit";
import { decrypt, randomToken } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { PermanentSendError, TransientSendError, sendEmail } from "../providers/email";
import { getObject, putObject } from "../providers/storage";
import { formatDate, todayISO } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { isHHMM, itemClock, timeProblems, to12 } from "@/lib/schedule";
import { assertBranch, branchScope } from "./scope";

/* ================= labels and starter templates ================= */

export const TYPE_LABEL: Record<ScheduleType, string> = {
  sunday: "Sunday service",
  midweek: "Midweek service",
  prayer: "Prayer meeting",
  communion: "Communion service",
  special: "Special programme",
  wedding: "Wedding",
  funeral: "Funeral service",
  custom: "Service",
};

export const typeLabelOf = (s: { serviceType: string; typeLabel?: string | null }) =>
  s.typeLabel?.trim() || TYPE_LABEL[s.serviceType as ScheduleType] || "Service";

const T = (title: string, durationMin?: number, description?: string) => ({ title, durationMin: durationMin ?? null, description: description ?? null });

export const STARTER_TEMPLATES: { name: string; serviceType: ScheduleType; body: ScheduleTemplateBody }[] = [
  {
    name: "Sunday celebration service",
    serviceType: "sunday",
    body: {
      title: "Sunday Celebration Service",
      startTime: "08:00",
      endTime: "10:30",
      venue: "Main auditorium",
      items: [
        T("Opening prayer", 10),
        T("Praise and worship", 25),
        T("Scripture reading", 5),
        T("Choir ministration", 10),
        T("Announcements", 10),
        T("Tithes and offering", 15),
        T("Sermon", 50),
        T("Altar call", 10),
        T("Thanksgiving and first-timers", 10),
        T("Benediction", 5),
      ],
    },
  },
  {
    name: "Midweek Bible study",
    serviceType: "midweek",
    body: {
      title: "Midweek Bible Study",
      startTime: "18:00",
      endTime: "19:30",
      items: [T("Opening prayer", 10), T("Worship", 15), T("Bible study", 50), T("Prayer session", 10), T("Closing prayer", 5)],
    },
  },
  {
    name: "Communion service",
    serviceType: "communion",
    body: {
      title: "Holy Communion Service",
      startTime: "08:00",
      endTime: "10:30",
      items: [
        T("Opening prayer", 10),
        T("Praise and worship", 20),
        T("Hymn", 5),
        T("Sermon", 40),
        T("Preparation for communion", 10),
        T("Holy communion", 25),
        T("Offering", 10),
        T("Benediction", 5),
      ],
    },
  },
  {
    name: "Prayer meeting",
    serviceType: "prayer",
    body: {
      title: "Prayer Meeting",
      startTime: "18:00",
      endTime: "19:30",
      items: [T("Worship", 15), T("Exhortation", 15), T("Prayer points", 50), T("Closing prayer", 10)],
    },
  },
  {
    name: "Wedding",
    serviceType: "wedding",
    body: {
      title: "Holy Matrimony",
      startTime: "10:00",
      endTime: "12:00",
      items: [
        T("Arrival of the bride", 10),
        T("Opening prayer", 5),
        T("Hymn", 5),
        T("Exhortation", 20),
        T("Vows and exchange of rings", 15),
        T("Signing of the register", 10),
        T("Special number", 5),
        T("Thanksgiving offering", 10),
        T("Benediction", 5),
      ],
    },
  },
  {
    name: "Funeral service",
    serviceType: "funeral",
    body: {
      title: "Service of Songs and Commendation",
      startTime: "10:00",
      endTime: "12:00",
      items: [
        T("Processional hymn", 5),
        T("Opening prayer", 5),
        T("Bible reading", 10),
        T("Tributes", 25),
        T("Sermon", 30),
        T("Commendation", 10),
        T("Recessional hymn", 5),
      ],
    },
  },
];

export async function createDefaultScheduleTemplates(tx: Tx, orgId: string) {
  await tx.insert(scheduleTemplates).values(STARTER_TEMPLATES.map((t) => ({ ...t, orgId, createdByName: "Build My Church" })));
}

/* ================= validation ================= */

const optText = (max: number, msg?: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .optional()
    .nullable()
    .transform((v) => v || null);
const optTime = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v || null);
const optUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => v || null);

export const assigneeSchema = z
  .object({
    memberId: optUuid,
    userId: optUuid,
    groupId: optUuid,
    name: z.string().trim().min(2, "Enter a name.").max(120),
    responsibility: optText(120),
  })
  .refine((a) => [a.memberId, a.userId, a.groupId].filter(Boolean).length <= 1, "Choose one person or group.");

export const itemSchema = z.object({
  title: z.string().trim().min(1, "Name this part of the programme.").max(120),
  startTime: optTime,
  durationMin: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v))),
  description: optText(1000),
  notes: optText(1000),
  custom: z
    .array(z.object({ label: z.string().trim().min(1, "Name the field.").max(40), value: z.string().trim().max(300) }))
    .max(10)
    .default([]),
  assignees: z.array(assigneeSchema).max(30).default([]),
});

export const scheduleSchema = z
  .object({
    id: z.string().uuid(),
    branchId: z.string().uuid("Choose a branch."),
    title: z.string().trim().min(3, "Give the service a title.").max(120),
    serviceType: z.enum(SCHEDULE_TYPES),
    typeLabel: optText(60),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date."),
    startTime: z.string().refine(isHHMM, "Enter a start time."),
    endTime: optTime,
    venue: optText(120),
    theme: optText(200),
    scripture: optText(200),
    presidingName: optText(120),
    presidingMemberId: optUuid,
    announcements: optText(3000),
    internalNotes: optText(3000),
    items: z.array(itemSchema).max(100, "A schedule can have up to 100 items."),
  })
  .superRefine((v, c) => {
    if (v.serviceType === "custom" && !v.typeLabel) c.addIssue({ code: "custom", path: ["typeLabel"], message: "Say what kind of service this is." });
    for (const [path, message] of Object.entries(timeProblems(v))) c.addIssue({ code: "custom", path: path.split("."), message });
  });
export type ScheduleInput = z.output<typeof scheduleSchema>;

/* ================= reading ================= */

export type ScheduleFilters = {
  q?: string;
  from?: string;
  to?: string;
  type?: string;
  status?: string;
  venue?: string;
  person?: string;
  branchId?: string;
  page?: number;
};

/** Readers only ever see published schedules; coordinators also see drafts. */
function visible(ctx: Actor): SQL | undefined {
  return and(
    isNull(serviceSchedules.deletedAt),
    branchScope(ctx, serviceSchedules.branchId),
    ctx.can("schedules.manage") ? undefined : sql`${serviceSchedules.currentVersion} > 0`,
  );
}

export async function listSchedules(tx: Tx, ctx: Actor, f: ScheduleFilters) {
  assertCan(ctx, "schedules.read", "see service schedules");
  const q = f.q?.trim();
  const person = f.person?.trim();
  const where = and(
    visible(ctx),
    q ? or(ilike(serviceSchedules.title, `%${q}%`), ilike(serviceSchedules.theme, `%${q}%`)) : undefined,
    f.from ? gte(serviceSchedules.serviceDate, f.from) : undefined,
    f.to ? lte(serviceSchedules.serviceDate, f.to) : undefined,
    f.type && (SCHEDULE_TYPES as readonly string[]).includes(f.type) ? eq(serviceSchedules.serviceType, f.type as ScheduleType) : undefined,
    f.status === "updated"
      ? and(eq(serviceSchedules.status, "published"), sql`${serviceSchedules.currentVersion} > 1`)
      : f.status === "draft" || f.status === "published" || f.status === "completed" || f.status === "archived"
        ? eq(serviceSchedules.status, f.status)
        : f.status === "all"
          ? undefined
          : ne(serviceSchedules.status, "archived"),
    f.venue ? ilike(serviceSchedules.venue, `%${f.venue}%`) : undefined,
    f.branchId ? eq(serviceSchedules.branchId, f.branchId) : undefined,
    person
      ? or(
          ilike(serviceSchedules.presidingName, `%${person}%`),
          exists(
            db
              .select({ x: sql`1` })
              .from(scheduleAssignments)
              .where(and(sql`${scheduleAssignments.scheduleId} = service_schedules.id`, ilike(scheduleAssignments.name, `%${person}%`))),
          ),
        )
      : undefined,
  );
  const page = Math.max(1, f.page ?? 1);
  const rows = await tx
    .select({
      id: serviceSchedules.id,
      title: serviceSchedules.title,
      serviceType: serviceSchedules.serviceType,
      typeLabel: serviceSchedules.typeLabel,
      serviceDate: serviceSchedules.serviceDate,
      startTime: serviceSchedules.startTime,
      venue: serviceSchedules.venue,
      presidingName: serviceSchedules.presidingName,
      status: serviceSchedules.status,
      currentVersion: serviceSchedules.currentVersion,
      hasChanges: serviceSchedules.hasChanges,
      updatedByName: serviceSchedules.updatedByName,
      createdByName: serviceSchedules.createdByName,
      updatedAt: serviceSchedules.updatedAt,
      branchName: branches.name,
      items: sql<number>`(select count(*)::int from schedule_items i where i.schedule_id = service_schedules.id)`,
      people: sql<number>`(select count(distinct coalesce(a.member_id::text, a.user_id::text, a.group_id::text, a.name))::int from schedule_assignments a where a.schedule_id = service_schedules.id)`,
      failed: sql<number>`(select count(*)::int from schedule_notifications n where n.schedule_id = service_schedules.id and n.status = 'failed')`,
    })
    .from(serviceSchedules)
    .innerJoin(branches, eq(branches.id, serviceSchedules.branchId))
    .where(where)
    .orderBy(desc(serviceSchedules.serviceDate), desc(serviceSchedules.startTime))
    .limit(25)
    .offset((page - 1) * 25);
  const [t] = await tx.select({ n: count() }).from(serviceSchedules).where(where);
  return { rows: rows.map((r) => ({ ...r, serviceDate: String(r.serviceDate) })), total: Number(t?.n ?? 0), page, pageSize: 25 };
}
export type ScheduleRow = Awaited<ReturnType<typeof listSchedules>>["rows"][number];

export async function upcomingSchedules(tx: Tx, ctx: Actor, limit = 4) {
  assertCan(ctx, "schedules.read", "see service schedules");
  const rows = await tx
    .select({
      id: serviceSchedules.id,
      title: serviceSchedules.title,
      serviceType: serviceSchedules.serviceType,
      typeLabel: serviceSchedules.typeLabel,
      serviceDate: serviceSchedules.serviceDate,
      startTime: serviceSchedules.startTime,
      venue: serviceSchedules.venue,
      status: serviceSchedules.status,
      currentVersion: serviceSchedules.currentVersion,
      hasChanges: serviceSchedules.hasChanges,
      presidingName: serviceSchedules.presidingName,
    })
    .from(serviceSchedules)
    .where(and(visible(ctx), gte(serviceSchedules.serviceDate, todayISO()), ne(serviceSchedules.status, "archived")))
    .orderBy(asc(serviceSchedules.serviceDate), asc(serviceSchedules.startTime))
    .limit(limit);
  return rows.map((r) => ({ ...r, serviceDate: String(r.serviceDate) }));
}

/** Schedules the signed-in user is part of (as staff), upcoming first. */
export async function mySchedules(tx: Tx, ctx: Actor) {
  const rows = await tx
    .select({
      id: serviceSchedules.id,
      title: serviceSchedules.title,
      serviceDate: serviceSchedules.serviceDate,
      startTime: serviceSchedules.startTime,
      item: scheduleItems.title,
    })
    .from(scheduleAssignments)
    .innerJoin(serviceSchedules, eq(serviceSchedules.id, scheduleAssignments.scheduleId))
    .innerJoin(scheduleItems, eq(scheduleItems.id, scheduleAssignments.itemId))
    .where(
      and(
        eq(scheduleAssignments.userId, ctx.user.id),
        isNull(serviceSchedules.deletedAt),
        sql`${serviceSchedules.currentVersion} > 0`,
        gte(serviceSchedules.serviceDate, todayISO()),
      ),
    )
    .orderBy(asc(serviceSchedules.serviceDate))
    .limit(10);
  return rows.map((r) => ({ ...r, serviceDate: String(r.serviceDate) }));
}

async function loadSchedule(tx: Tx, ctx: Actor, id: string, lock = false) {
  const q = tx.select().from(serviceSchedules).where(and(eq(serviceSchedules.id, id), isNull(serviceSchedules.deletedAt)));
  const [s] = lock ? await q.for("update") : await q;
  if (!s) throw notFound("That schedule");
  assertBranch(ctx, s.branchId);
  return s;
}

async function itemsWithAssignees(tx: Tx, scheduleId: string) {
  const items = await tx.select().from(scheduleItems).where(eq(scheduleItems.scheduleId, scheduleId)).orderBy(asc(scheduleItems.position));
  const asg = await tx.select().from(scheduleAssignments).where(eq(scheduleAssignments.scheduleId, scheduleId)).orderBy(asc(scheduleAssignments.createdAt));
  return items.map((i) => ({ ...i, assignees: asg.filter((a) => a.itemId === i.id) }));
}

export const personKey = (a: { memberId?: string | null; userId?: string | null; groupId?: string | null; name: string }) =>
  a.memberId ? `member:${a.memberId}` : a.userId ? `user:${a.userId}` : a.groupId ? `group:${a.groupId}` : `name:${a.name.trim().toLowerCase()}`;

/** The schedule as it would be printed now. */
export async function snapshotOf(tx: Tx, scheduleId: string): Promise<ScheduleSnapshot> {
  const [s] = await tx
    .select({ s: serviceSchedules, branchName: branches.name })
    .from(serviceSchedules)
    .innerJoin(branches, eq(branches.id, serviceSchedules.branchId))
    .where(eq(serviceSchedules.id, scheduleId));
  if (!s) throw notFound("That schedule");
  const items = await itemsWithAssignees(tx, scheduleId);
  return {
    title: s.s.title,
    serviceType: s.s.serviceType,
    typeLabel: s.s.typeLabel,
    serviceDate: String(s.s.serviceDate),
    startTime: s.s.startTime,
    endTime: s.s.endTime,
    venue: s.s.venue,
    theme: s.s.theme,
    scripture: s.s.scripture,
    presidingName: s.s.presidingName,
    announcements: s.s.announcements,
    branchName: s.branchName,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      startTime: i.startTime,
      durationMin: i.durationMin,
      description: i.description,
      custom: i.custom,
      assignees: i.assignees.map((a) => ({ key: personKey(a), name: a.name, responsibility: a.responsibility })),
    })),
  };
}

export async function getSchedule(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "schedules.read", "see service schedules");
  const s = await loadSchedule(tx, ctx, id);
  const canManage = ctx.can("schedules.manage");
  if (!canManage && s.currentVersion === 0) throw notFound("That schedule");
  const [b] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, s.branchId));
  const versions = await tx
    .select({
      id: scheduleVersions.id,
      version: scheduleVersions.version,
      changeSummary: scheduleVersions.changeSummary,
      note: scheduleVersions.note,
      publishedByName: scheduleVersions.publishedByName,
      publishedAt: scheduleVersions.publishedAt,
      pdfStatus: scheduleVersions.pdfStatus,
      pdfError: scheduleVersions.pdfError,
      fileId: scheduleVersions.fileId,
      snapshot: scheduleVersions.snapshot,
    })
    .from(scheduleVersions)
    .where(eq(scheduleVersions.scheduleId, id))
    .orderBy(desc(scheduleVersions.version));
  const current = versions.find((v) => v.version === s.currentVersion);
  return {
    ...s,
    serviceDate: String(s.serviceDate),
    branchName: b?.name ?? "",
    internalNotes: canManage ? s.internalNotes : null,
    canManage,
    // readers see what was published, not unpublished edits
    items: canManage ? await itemsWithAssignees(tx, id) : [],
    published: current?.snapshot ?? null,
    versions: versions.map((v) => ({ ...v, snapshot: undefined })),
  };
}

/* ================= saving ================= */

async function replaceItems(tx: Tx, ctx: Actor, scheduleId: string, items: ScheduleInput["items"]) {
  await tx.delete(scheduleAssignments).where(eq(scheduleAssignments.scheduleId, scheduleId));
  await tx.delete(scheduleItems).where(eq(scheduleItems.scheduleId, scheduleId));
  if (!items.length) return;
  const rows = await tx
    .insert(scheduleItems)
    .values(
      items.map((it, i) => ({
        orgId: ctx.org.id,
        scheduleId,
        position: i + 1,
        title: it.title,
        startTime: it.startTime,
        durationMin: it.durationMin,
        description: it.description,
        notes: it.notes,
        custom: it.custom.filter((c) => c.value),
      })),
    )
    .returning({ id: scheduleItems.id, position: scheduleItems.position });
  const byPos = new Map(rows.map((r) => [r.position, r.id]));
  const asg = items.flatMap((it, i) =>
    it.assignees.map((a) => ({
      orgId: ctx.org.id,
      scheduleId,
      itemId: byPos.get(i + 1)!,
      memberId: a.memberId,
      userId: a.userId,
      groupId: a.groupId,
      name: a.name,
      responsibility: a.responsibility,
    })),
  );
  if (asg.length) await tx.insert(scheduleAssignments).values(asg);
}

/** People named on the schedule must belong to this church: checked here, not trusted from the browser. */
async function checkPeople(tx: Tx, input: ScheduleInput) {
  const all = input.items.flatMap((i) => i.assignees);
  const mIds = [...new Set([...all.map((a) => a.memberId), input.presidingMemberId].filter(Boolean) as string[])];
  const uIds = [...new Set(all.map((a) => a.userId).filter(Boolean) as string[])];
  const gIds = [...new Set(all.map((a) => a.groupId).filter(Boolean) as string[])];
  if (mIds.length) {
    const ok = await tx.select({ id: members.id }).from(members).where(and(inArray(members.id, mIds), isNull(members.deletedAt)));
    if (ok.length !== mIds.length) throw new AppError("One of the people chosen is no longer a member. Choose them again.");
  }
  if (uIds.length) {
    const ok = await tx.select({ id: memberships.userId }).from(memberships).where(inArray(memberships.userId, uIds));
    if (ok.length !== uIds.length) throw new AppError("One of the staff chosen is no longer on the team. Choose them again.");
  }
  if (gIds.length) {
    const ok = await tx.select({ id: groups.id }).from(groups).where(inArray(groups.id, gIds));
    if (ok.length !== gIds.length) throw new AppError("One of the groups chosen no longer exists.");
  }
}

/**
 * Saves the whole schedule. The browser picks the id for a new schedule, so pressing Save twice
 * updates the same schedule instead of creating two.
 */
export async function saveSchedule(tx: Tx, ctx: Actor, input: ScheduleInput) {
  assertCan(ctx, "schedules.manage", "edit service schedules");
  assertBranch(ctx, input.branchId);
  await checkPeople(tx, input);
  const values = {
    branchId: input.branchId,
    title: input.title,
    serviceType: input.serviceType,
    typeLabel: input.typeLabel,
    serviceDate: input.serviceDate,
    startTime: input.startTime,
    endTime: input.endTime,
    venue: input.venue,
    theme: input.theme,
    scripture: input.scripture,
    presidingName: input.presidingName,
    presidingMemberId: input.presidingMemberId,
    announcements: input.announcements,
    internalNotes: input.internalNotes,
    updatedBy: ctx.user.id,
    updatedByName: ctx.user.name,
  };
  const [existing] = await tx.select().from(serviceSchedules).where(eq(serviceSchedules.id, input.id)).for("update");
  if (existing) {
    if (existing.deletedAt) throw notFound("That schedule");
    assertBranch(ctx, existing.branchId);
    if (existing.status === "archived") throw new AppError("This schedule is archived. Restore it before editing.");
    await tx
      .update(serviceSchedules)
      .set({ ...values, hasChanges: existing.currentVersion > 0, status: existing.status === "completed" ? "published" : existing.status })
      .where(eq(serviceSchedules.id, input.id));
  } else {
    await tx.insert(serviceSchedules).values({ ...values, id: input.id, orgId: ctx.org.id, createdBy: ctx.user.id, createdByName: ctx.user.name });
  }
  await replaceItems(tx, ctx, input.id, input.items);
  await audit(tx, ctx, {
    action: existing ? "schedule.updated" : "schedule.created",
    summary: `${existing ? "Edited" : "Created"} the schedule "${input.title}" for ${formatDate(input.serviceDate)} (${input.items.length} item${input.items.length === 1 ? "" : "s"})`,
    entityType: "schedule",
    entityId: input.id,
  });
  return { id: input.id, created: !existing, hasChanges: !!existing && existing.currentVersion > 0 };
}

/* ================= publishing and change detection ================= */

type Change = { key: string; name: string; reason: "published" | "assigned" | "changed" | "removed"; detail: string };

const partsOf = (snap: ScheduleSnapshot) => {
  const clock = itemClock(snap.startTime, snap.items);
  const map = new Map<string, { name: string; parts: string[] }>();
  snap.items.forEach((it, i) => {
    for (const a of it.assignees) {
      if (a.key.startsWith("name:")) continue;
      const line = `${it.title}${clock[i]!.start ? ` at ${to12(clock[i]!.start)}` : ""}${a.responsibility ? ` (${a.responsibility})` : ""}${it.description ? `: ${it.description}` : ""}`;
      const e = map.get(a.key) ?? { name: a.name, parts: [] };
      e.parts.push(line);
      map.set(a.key, e);
    }
  });
  return map;
};

/**
 * Who needs to hear about a new version, and why. Everyone on the first version; after that, only people
 * whose own part was added, changed or removed, unless the date, time or venue moved (then everyone).
 */
export function changesBetween(prev: ScheduleSnapshot | null, next: ScheduleSnapshot): Change[] {
  const now = partsOf(next);
  if (!prev) return [...now].map(([key, v]) => ({ key, name: v.name, reason: "published", detail: v.parts.join("; ") }));
  const before = partsOf(prev);
  const moved: string[] = [];
  if (prev.serviceDate !== next.serviceDate) moved.push(`the date is now ${formatDate(next.serviceDate, "long")}`);
  if (prev.startTime !== next.startTime || prev.endTime !== next.endTime) moved.push(`it now starts at ${to12(next.startTime)}`);
  if ((prev.venue ?? "") !== (next.venue ?? "")) moved.push(`the venue is now ${next.venue ?? "to be confirmed"}`);
  const out: Change[] = [];
  for (const [key, v] of now) {
    const old = before.get(key);
    if (!old) out.push({ key, name: v.name, reason: "assigned", detail: v.parts.join("; ") });
    else if (old.parts.join("|") !== v.parts.join("|") || moved.length)
      out.push({
        key,
        name: v.name,
        reason: "changed",
        detail: [...(moved.length ? [`The service has moved: ${moved.join(", ")}.`] : []), `Your part: ${v.parts.join("; ")}`].join(" "),
      });
  }
  for (const [key, v] of before) if (!now.has(key)) out.push({ key, name: v.name, reason: "removed", detail: `You're no longer down for: ${v.parts.join("; ")}` });
  return out;
}

function summarise(prev: ScheduleSnapshot | null, next: ScheduleSnapshot, changes: Change[]) {
  if (!prev) return `First published with ${next.items.length} items`;
  const bits: string[] = [];
  if (prev.serviceDate !== next.serviceDate) bits.push("date changed");
  if (prev.startTime !== next.startTime || prev.endTime !== next.endTime) bits.push("time changed");
  if ((prev.venue ?? "") !== (next.venue ?? "")) bits.push("venue changed");
  const added = next.items.filter((i) => !prev.items.some((p) => p.title === i.title)).length;
  const removed = prev.items.filter((i) => !next.items.some((n) => n.title === i.title)).length;
  if (added) bits.push(`${added} item${added === 1 ? "" : "s"} added`);
  if (removed) bits.push(`${removed} item${removed === 1 ? "" : "s"} removed`);
  const affected = changes.length;
  if (affected) bits.push(`${affected} ${affected === 1 ? "person" : "people"} affected`);
  return bits.length ? bits.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Wording and details updated; no one's part changed";
}

export const publishSchema = z.object({
  id: z.string().uuid(),
  notify: z.boolean().default(true),
  note: optText(500),
});

/** Who would be told if this were published now (for the publish dialog). */
export async function publishPreview(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "schedules.manage", "publish schedules");
  const s = await loadSchedule(tx, ctx, id);
  const next = await snapshotOf(tx, id);
  const [prev] = s.currentVersion
    ? await tx
        .select({ snapshot: scheduleVersions.snapshot })
        .from(scheduleVersions)
        .where(and(eq(scheduleVersions.scheduleId, id), eq(scheduleVersions.version, s.currentVersion)))
    : [];
  const changes = changesBetween(prev?.snapshot ?? null, next);
  return { version: s.currentVersion + 1, changes, summary: summarise(prev?.snapshot ?? null, next, changes) };
}

export async function publishSchedule(tx: Tx, ctx: Actor, input: z.output<typeof publishSchema>) {
  assertCan(ctx, "schedules.manage", "publish schedules");
  const s = await loadSchedule(tx, ctx, input.id, true);
  if (s.status === "archived") throw new AppError("Restore this schedule before publishing it.");
  if (s.currentVersion > 0 && !s.hasChanges) throw new AppError("Nothing has changed since the last version was published.");
  const next = await snapshotOf(tx, input.id);
  if (!next.items.length) throw new AppError("Add at least one item to the programme before publishing.");
  const problems = timeProblems(next);
  if (Object.keys(problems).length) throw new AppError(`Fix the times first: ${Object.values(problems)[0]}`);
  const [prev] = s.currentVersion
    ? await tx
        .select({ snapshot: scheduleVersions.snapshot })
        .from(scheduleVersions)
        .where(and(eq(scheduleVersions.scheduleId, s.id), eq(scheduleVersions.version, s.currentVersion)))
    : [];
  const changes = changesBetween(prev?.snapshot ?? null, next);
  const version = s.currentVersion + 1;
  const summary = summarise(prev?.snapshot ?? null, next, changes);
  const [v] = await tx
    .insert(scheduleVersions)
    .values({
      orgId: ctx.org.id,
      scheduleId: s.id,
      version,
      snapshot: next,
      changeSummary: summary,
      note: input.note,
      publishedBy: ctx.user.id,
      publishedByName: ctx.user.name,
    })
    .returning({ id: scheduleVersions.id });
  const now = new Date();
  await tx
    .update(serviceSchedules)
    .set({
      status: "published",
      currentVersion: version,
      hasChanges: false,
      lastPublishedAt: now,
      firstPublishedAt: s.firstPublishedAt ?? now,
      updatedBy: ctx.user.id,
      updatedByName: ctx.user.name,
    })
    .where(eq(serviceSchedules.id, s.id));
  if (input.notify && changes.length)
    await tx.insert(scheduleNotifications).values(
      changes.map((c) => ({
        orgId: ctx.org.id,
        scheduleId: s.id,
        version,
        recipientKey: c.key,
        recipientName: c.name,
        reason: c.reason,
        detail: c.detail,
        createdBy: ctx.user.id,
      })),
    );
  await enqueue(tx, "schedule.pdf", { versionId: v!.id, notify: input.notify && changes.length > 0 }, { orgId: ctx.org.id, dedupeKey: `schedule-pdf:${v!.id}`, maxAttempts: 4 });
  await audit(tx, ctx, {
    action: version === 1 ? "schedule.published" : "schedule.republished",
    summary: `Published version ${version} of "${s.title}": ${summary}${input.notify ? (changes.length ? `. Notifying ${changes.length}.` : ". No one needed notifying.") : ". Notifications switched off."}`,
    entityType: "schedule",
    entityId: s.id,
  });
  return { version, notified: input.notify ? changes.length : 0 };
}

/* ================= PDF ================= */

/**
 * Loaded on demand: the PDF library is ESM-only, and this keeps scripts that load this file
 * (the worker, the seed) from failing when they don't render a PDF.
 */
const renderSchedulePdf = async (...a: Parameters<typeof import("../pdf/schedule").renderSchedulePdf>) =>
  (await import("../pdf/schedule")).renderSchedulePdf(...a);

async function churchLogo(tx: Tx, orgId: string) {
  const [o] = await tx.select({ logoFileId: organisations.logoFileId }).from(organisations).where(eq(organisations.id, orgId));
  if (!o?.logoFileId) return null;
  const [f] = await tx.select().from(files).where(eq(files.id, o.logoFileId));
  if (!f || !/^image\/(png|jpeg)$/.test(f.mime)) return null;
  try {
    return await getObject(f.storageKey);
  } catch {
    return null;
  }
}

/** Renders the PDF for a published version, stores it, and then lets the notifications go. */
export async function generateVersionPdf(orgId: string, versionId: string, opts: { final?: boolean; notify?: boolean } = {}) {
  await withOrg(orgId, async (tx) => {
    const [v] = await tx.select().from(scheduleVersions).where(eq(scheduleVersions.id, versionId));
    if (!v || v.pdfStatus === "ready") return;
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
    try {
      const buf = await renderSchedulePdf({
        snap: v.snapshot,
        church: o!.name,
        logo: await churchLogo(tx, orgId),
        version: v.version,
        publishedAt: v.publishedAt,
        publishedBy: v.publishedByName,
        typeLabel: typeLabelOf(v.snapshot),
      });
      if (buf.length < 800) throw new Error("The PDF came out empty.");
      const fileId = randomUUID();
      const key = `${orgId}/${new Date().getUTCFullYear()}/${fileId}.pdf`;
      await putObject(key, buf);
      const name = `${v.snapshot.title} - ${v.snapshot.serviceDate} - v${v.version}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
      await tx.insert(files).values({
        id: fileId,
        orgId,
        name,
        mime: "application/pdf",
        size: buf.length,
        storageKey: key,
        sha256: createHash("sha256").update(buf).digest("hex"),
        entityType: "schedule",
        entityId: v.scheduleId,
        uploadedByName: "Build My Church",
      });
      await tx.update(scheduleVersions).set({ fileId, pdfStatus: "ready", pdfError: null }).where(eq(scheduleVersions.id, v.id));
    } catch (e) {
      // keep trying; on the last attempt, record the failure and send the notifications without the attachment
      if (!opts.final) throw e;
      await tx.update(scheduleVersions).set({ pdfStatus: "failed", pdfError: (e as Error).message.slice(0, 300) }).where(eq(scheduleVersions.id, v.id));
    }
    if (opts.notify)
      await enqueue(tx, "schedule.notify", { scheduleId: v.scheduleId, version: v.version }, { orgId, dedupeKey: `schedule-notify:${v.id}`, maxAttempts: 6 });
  });
}

/** A PDF of the schedule as it is now, for coordinators to check before publishing. Never stored or sent. */
export async function previewPdf(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "schedules.manage", "preview schedules");
  const s = await loadSchedule(tx, ctx, id);
  const snap = await snapshotOf(tx, id);
  return {
    name: `${s.title} - preview.pdf`,
    bytes: await renderSchedulePdf({ snap, church: ctx.org.name, logo: await churchLogo(tx, ctx.org.id), version: null, typeLabel: typeLabelOf(snap) }),
  };
}

/** The stored PDF of a version (the current one by default) for anyone allowed to see the schedule. */
export async function versionPdf(tx: Tx, ctx: Actor, id: string, version?: number) {
  assertCan(ctx, "schedules.read", "download schedules");
  const s = await loadSchedule(tx, ctx, id);
  if (!ctx.can("schedules.manage") && s.currentVersion === 0) throw notFound("That schedule");
  const v = version ?? s.currentVersion;
  if (!v) throw new AppError("This schedule hasn't been published yet.");
  return pdfOfVersion(tx, s.id, v);
}

async function pdfOfVersion(tx: Tx, scheduleId: string, v: number) {
  const [row] = await tx
    .select({ ver: scheduleVersions, file: files })
    .from(scheduleVersions)
    .leftJoin(files, eq(files.id, scheduleVersions.fileId))
    .where(and(eq(scheduleVersions.scheduleId, scheduleId), eq(scheduleVersions.version, v)));
  if (!row) throw notFound("That version");
  if (!row.file) {
    if (row.ver.pdfStatus === "failed") throw new AppError(`The PDF for this version couldn't be made: ${row.ver.pdfError ?? "unknown problem"}.`);
    throw new AppError("The PDF is still being made. Try again in a few seconds.", undefined, "pdf_pending");
  }
  return { name: row.file.name, bytes: await getObject(row.file.storageKey) };
}

/* ================= notifications ================= */

async function contactFor(tx: Tx, key: string) {
  const [kind, id] = key.split(":") as [string, string];
  if (kind === "member") {
    const [m] = await tx
      .select({ firstName: members.firstName, emailEnc: members.emailEnc, phoneEnc: members.phoneEnc })
      .from(members)
      .where(and(eq(members.id, id), isNull(members.deletedAt)));
    return m ? { first: m.firstName, email: decrypt(m.emailEnc), phone: decrypt(m.phoneEnc) } : null;
  }
  if (kind === "user") {
    const [u] = await tx.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, id));
    return u ? { first: u.name.replace(/^(Pastor|Pst\.?|Rev\.?|Dr\.?|Mr\.?|Mrs\.?|Bro\.?|Sis\.?|Deacon|Deaconess|Elder)\s+/i, "").split(" ")[0]!, email: u.email, phone: u.phone } : null;
  }
  return null;
}

/** A link assignees can open without an account: the current version, nothing private. */
export async function shareToken(tx: Tx, orgId: string, scheduleId: string, serviceDate: string) {
  const [l] = await tx
    .select()
    .from(publicLinks)
    .where(and(eq(publicLinks.orgId, orgId), eq(publicLinks.kind, "schedule"), eq(publicLinks.targetId, scheduleId), isNull(publicLinks.revokedAt)));
  const expiresAt = new Date(new Date(`${serviceDate}T23:59:00+01:00`).getTime() + 60 * 86400_000);
  if (l) {
    if (!l.expiresAt || l.expiresAt.getTime() !== expiresAt.getTime())
      await tx.update(publicLinks).set({ expiresAt }).where(eq(publicLinks.token, l.token));
    return l.token;
  }
  const token = randomToken(18);
  await tx.insert(publicLinks).values({ token, orgId, kind: "schedule", targetId: scheduleId, expiresAt });
  return token;
}

const REASON_HEADING = {
  published: "You're on the programme",
  assigned: "You've been added to the programme",
  changed: "Your part in the programme has changed",
  removed: "You've been taken off the programme",
  resend: "Your part in the programme",
} as const;

/** Sends the pending notifications for a version: email with the PDF where there's an address, otherwise SMS. */
export async function sendScheduleNotifications(orgId: string, scheduleId: string, version: number) {
  let retry = 0;
  const pending = await withOrg(orgId, (tx) =>
    tx
      .select()
      .from(scheduleNotifications)
      .where(and(eq(scheduleNotifications.scheduleId, scheduleId), eq(scheduleNotifications.version, version), eq(scheduleNotifications.status, "pending"))),
  );
  if (!pending.length) return;
  const ctxData = await withOrg(orgId, async (tx) => {
    const [o] = await tx.select().from(organisations).where(eq(organisations.id, orgId));
    const [s] = await tx.select().from(serviceSchedules).where(eq(serviceSchedules.id, scheduleId));
    const [latest] = await tx.select().from(scheduleVersions).where(and(eq(scheduleVersions.scheduleId, scheduleId), eq(scheduleVersions.version, s!.currentVersion)));
    const token = await shareToken(tx, orgId, scheduleId, String(s!.serviceDate));
    let pdf: { name: string; bytes: Buffer } | null = null;
    try {
      pdf = await pdfOfVersion(tx, scheduleId, s!.currentVersion);
    } catch {}
    return { o: o!, snap: latest!.snapshot, token, pdf };
  });
  const { o, snap, token, pdf } = ctxData;
  const link = `${env().APP_URL}/s/${token}`;
  const when = `${formatDate(snap.serviceDate, "long")} at ${to12(snap.startTime)}`;
  for (const n of pending) {
    const contact = await withOrg(orgId, (tx) => contactFor(tx, n.recipientKey));
    const facts = [
      ["Service", `${snap.title} (${typeLabelOf(snap)})`],
      ["When", when],
      ...(snap.venue ? [["Venue", snap.venue]] : []),
    ] as [string, string][];
    try {
      if (!contact || (!contact.email && !contact.phone)) throw new PermanentSendError("No email or phone number on record");
      if (contact.email) {
        const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 14px;font-size:14px">${facts
          .map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#5b6884;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`)
          .join("")}</table>`;
        const r = await sendEmail({
          to: contact.email,
          subject: `${n.reason === "removed" ? "Change" : n.reason === "changed" ? "Updated" : "Your part"}: ${snap.title}, ${formatDate(snap.serviceDate)}`,
          html: emailLayout({
            church: o.name,
            preheader: n.detail ?? snap.title,
            heading: REASON_HEADING[n.reason],
            bodyHtml:
              p(`Dear ${contact.first},`) +
              table +
              `<p style="margin:0 0 12px;padding:10px 12px;background:#f4f6fb;border-radius:8px">${esc(n.detail ?? "")}</p>` +
              (snap.announcements && n.reason !== "removed" ? p(`Instructions: ${snap.announcements}`) : "") +
              (pdf && n.reason !== "removed" ? p("The full order of service is attached as a PDF.") : ""),
            button: n.reason === "removed" ? undefined : { label: "View the full schedule", url: link },
            footer: `${o.name} · Sent because you're named on this service schedule.`,
          }),
          attachments: pdf && n.reason !== "removed" ? [{ filename: pdf.name, content: pdf.bytes, contentType: "application/pdf" }] : undefined,
        });
        await withOrg(orgId, (tx) =>
          tx
            .update(scheduleNotifications)
            .set({
              status: "sent",
              channel: "email",
              toMasked: `${contact.email!.slice(0, 1)}•••@${contact.email!.split("@")[1]}`,
              sentAt: new Date(),
              error: null,
              attempts: n.attempts + 1,
            })
            .where(eq(scheduleNotifications.id, n.id)),
        );
        void r;
      } else {
        const { sendDirect } = await import("./messaging");
        const body =
          n.reason === "removed"
            ? `${o.name}: you're no longer on the programme for ${snap.title} on ${formatDate(snap.serviceDate)}.`
            : `${o.name}: ${snap.title}, ${when}${snap.venue ? `, ${snap.venue}` : ""}. ${n.detail ?? ""} Full schedule: ${link}`;
        const r = await withOrg(orgId, (tx) =>
          sendDirect(tx, orgId, { channel: "sms", to: contact.phone!, name: n.recipientName, memberId: n.recipientKey.startsWith("member:") ? n.recipientKey.slice(7) : null, body: body.slice(0, 600), purpose: "schedule" }),
        );
        await withOrg(orgId, (tx) =>
          tx
            .update(scheduleNotifications)
            .set(
              r.sent
                ? { status: "sent", channel: "sms", toMasked: maskPhone(contact.phone!), messageId: r.id, sentAt: new Date(), error: null, attempts: n.attempts + 1 }
                : { status: "failed", channel: "sms", toMasked: maskPhone(contact.phone!), error: "Not enough SMS units, and there's no email address", attempts: n.attempts + 1 },
            )
            .where(eq(scheduleNotifications.id, n.id)),
        );
      }
    } catch (e) {
      const transient = e instanceof TransientSendError && n.attempts < 4;
      await withOrg(orgId, (tx) =>
        tx
          .update(scheduleNotifications)
          .set({ status: transient ? "pending" : "failed", error: (e as Error).message.slice(0, 300), attempts: n.attempts + 1 })
          .where(eq(scheduleNotifications.id, n.id)),
      );
      if (transient) retry++;
    }
  }
  await withOrg(orgId, async (tx) => {
    const [s] = await tx.select({ title: serviceSchedules.title }).from(serviceSchedules).where(eq(serviceSchedules.id, scheduleId));
    const [r] = await tx
      .select({
        sent: sql<number>`count(*) filter (where ${scheduleNotifications.status} = 'sent')::int`,
        failed: sql<number>`count(*) filter (where ${scheduleNotifications.status} = 'failed')::int`,
      })
      .from(scheduleNotifications)
      .where(and(eq(scheduleNotifications.scheduleId, scheduleId), eq(scheduleNotifications.version, version)));
    await audit(tx, systemActor({ id: orgId, name: o.name }, "Schedule notifications", []), {
      action: "schedule.notified",
      summary: `Notifications for "${s?.title}" version ${version}: ${r?.sent ?? 0} sent, ${r?.failed ?? 0} failed`,
      entityType: "schedule",
      entityId: scheduleId,
    });
  });
  if (retry) throw new TransientSendError(`${retry} notification${retry === 1 ? "" : "s"} will be retried`);
}

export async function listNotifications(tx: Tx, ctx: Actor, scheduleId: string) {
  assertCan(ctx, "schedules.manage", "see notification history");
  await loadSchedule(tx, ctx, scheduleId);
  const rows = await tx
    .select({ n: scheduleNotifications, msgStatus: messages.status, msgError: messages.error, deliveredAt: messages.deliveredAt })
    .from(scheduleNotifications)
    .leftJoin(messages, eq(messages.id, scheduleNotifications.messageId))
    .where(eq(scheduleNotifications.scheduleId, scheduleId))
    .orderBy(desc(scheduleNotifications.version), asc(scheduleNotifications.recipientName));
  // SMS status comes from the message outbox, which hears back from the network
  return rows.map(({ n, msgStatus, msgError, deliveredAt }) => {
    let status = n.status;
    let error = n.error;
    if (n.messageId && msgStatus) {
      if (msgStatus === "delivered") status = "delivered";
      else if (msgStatus === "failed") {
        status = "failed";
        error = msgError ?? error;
      }
    }
    return { ...n, status, error, deliveredAt };
  });
}
export type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];

/** Sends everyone currently on the schedule their part again, e.g. the day before the service. */
export async function resendNotifications(tx: Tx, ctx: Actor, scheduleId: string, keys?: string[]) {
  assertCan(ctx, "schedules.manage", "send schedule notifications");
  const s = await loadSchedule(tx, ctx, scheduleId);
  if (!s.currentVersion) throw new AppError("Publish the schedule first.");
  const [v] = await tx
    .select()
    .from(scheduleVersions)
    .where(and(eq(scheduleVersions.scheduleId, scheduleId), eq(scheduleVersions.version, s.currentVersion)));
  let people = [...partsOf(v!.snapshot)].map(([key, x]) => ({ key, name: x.name, detail: `Your part: ${x.parts.join("; ")}` }));
  if (keys?.length) people = people.filter((x) => keys.includes(x.key));
  if (!people.length) throw new AppError("No one on this schedule can be notified. Add people from the member list or the team.");
  const stamp = Date.now();
  await tx.insert(scheduleNotifications).values(
    people.map((x) => ({ orgId: ctx.org.id, scheduleId, version: s.currentVersion, recipientKey: x.key, recipientName: x.name, reason: "resend" as const, detail: x.detail, createdBy: ctx.user.id })),
  );
  await enqueue(tx, "schedule.notify", { scheduleId, version: s.currentVersion }, { orgId: ctx.org.id, dedupeKey: `schedule-resend:${scheduleId}:${stamp}`, maxAttempts: 6 });
  await audit(tx, ctx, {
    action: "schedule.resent",
    summary: `Resent "${s.title}" to ${people.length} ${people.length === 1 ? "person" : "people"}`,
    entityType: "schedule",
    entityId: scheduleId,
  });
  return people.length;
}

export async function retryFailedNotifications(tx: Tx, ctx: Actor, scheduleId: string) {
  assertCan(ctx, "schedules.manage", "send schedule notifications");
  const s = await loadSchedule(tx, ctx, scheduleId);
  const failed = (await listNotifications(tx, ctx, scheduleId)).filter((n) => n.status === "failed");
  if (!failed.length) throw new AppError("Nothing failed, so there's nothing to retry.");
  const versions = [...new Set(failed.map((f) => f.version))];
  await tx
    .update(scheduleNotifications)
    .set({ status: "pending", error: null, messageId: null, channel: null })
    .where(inArray(scheduleNotifications.id, failed.map((f) => f.id)));
  const stamp = Date.now();
  for (const v of versions)
    await enqueue(tx, "schedule.notify", { scheduleId, version: v }, { orgId: ctx.org.id, dedupeKey: `schedule-retry:${scheduleId}:${v}:${stamp}`, maxAttempts: 6 });
  await audit(tx, ctx, {
    action: "schedule.retried",
    summary: `Retried ${failed.length} failed notification${failed.length === 1 ? "" : "s"} for "${s.title}"`,
    entityType: "schedule",
    entityId: scheduleId,
  });
  return failed.length;
}

/* ================= lifecycle ================= */

export async function duplicateSchedule(tx: Tx, ctx: Actor, id: string, serviceDate?: string) {
  assertCan(ctx, "schedules.manage", "create schedules");
  const s = await loadSchedule(tx, ctx, id);
  const items = await itemsWithAssignees(tx, id);
  const nextWeek = new Date(`${String(s.serviceDate)}T12:00:00+01:00`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const newId = randomUUID();
  const r = await saveSchedule(tx, ctx, {
    id: newId,
    branchId: s.branchId,
    title: s.title,
    serviceType: s.serviceType,
    typeLabel: s.typeLabel,
    serviceDate: serviceDate ?? nextWeek.toISOString().slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    venue: s.venue,
    theme: null,
    scripture: null,
    presidingName: s.presidingName,
    presidingMemberId: s.presidingMemberId,
    announcements: s.announcements,
    internalNotes: s.internalNotes,
    items: items.map((i) => ({
      title: i.title,
      startTime: i.startTime,
      durationMin: i.durationMin,
      description: i.description,
      notes: i.notes,
      custom: i.custom,
      assignees: i.assignees.map((a) => ({ memberId: a.memberId, userId: a.userId, groupId: a.groupId, name: a.name, responsibility: a.responsibility })),
    })),
  });
  return r.id;
}

export async function setArchived(tx: Tx, ctx: Actor, id: string, archived: boolean) {
  assertCan(ctx, "schedules.manage", "archive schedules");
  const s = await loadSchedule(tx, ctx, id, true);
  const status = archived ? "archived" : s.currentVersion ? (String(s.serviceDate) < todayISO() ? "completed" : "published") : "draft";
  await tx.update(serviceSchedules).set({ status, archivedAt: archived ? new Date() : null }).where(eq(serviceSchedules.id, id));
  await audit(tx, ctx, {
    action: archived ? "schedule.archived" : "schedule.restored",
    summary: `${archived ? "Archived" : "Restored"} the schedule "${s.title}"`,
    entityType: "schedule",
    entityId: id,
  });
}

/** Deleting hides the schedule; its versions, PDFs and audit history stay for the record. */
export async function deleteSchedule(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "schedules.manage", "delete schedules");
  const s = await loadSchedule(tx, ctx, id, true);
  await tx.update(serviceSchedules).set({ deletedAt: new Date(), deletedBy: ctx.user.id }).where(eq(serviceSchedules.id, id));
  await tx
    .update(publicLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(publicLinks.orgId, ctx.org.id), eq(publicLinks.kind, "schedule"), eq(publicLinks.targetId, id), isNull(publicLinks.revokedAt)));
  await audit(tx, ctx, {
    action: "schedule.deleted",
    summary: `Deleted the schedule "${s.title}" for ${formatDate(String(s.serviceDate))}${s.currentVersion ? ` (${s.currentVersion} published version${s.currentVersion === 1 ? "" : "s"} kept for the record)` : ""}`,
    entityType: "schedule",
    entityId: id,
  });
}

/** Daily: services that have happened are marked completed. */
export async function completePastSchedules(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx
      .update(serviceSchedules)
      .set({ status: "completed" })
      .where(and(eq(serviceSchedules.status, "published"), lt(serviceSchedules.serviceDate, todayISO()), isNull(serviceSchedules.deletedAt)))
      .returning({ id: serviceSchedules.id }),
  );
}

/* ================= templates ================= */

export async function listTemplates(tx: Tx) {
  return tx.select().from(scheduleTemplates).where(isNull(scheduleTemplates.archivedAt)).orderBy(asc(scheduleTemplates.serviceType), asc(scheduleTemplates.name));
}

export const saveAsTemplateSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(3, "Name the template.").max(80) });

export async function saveAsTemplate(tx: Tx, ctx: Actor, input: z.output<typeof saveAsTemplateSchema>) {
  assertCan(ctx, "schedules.manage", "save templates");
  const s = await loadSchedule(tx, ctx, input.id);
  const items = await itemsWithAssignees(tx, input.id);
  const [t] = await tx
    .insert(scheduleTemplates)
    .values({
      orgId: ctx.org.id,
      name: input.name,
      serviceType: s.serviceType,
      body: {
        title: s.title,
        startTime: s.startTime,
        endTime: s.endTime,
        venue: s.venue,
        announcements: s.announcements,
        items: items.map((i) => ({ title: i.title, durationMin: i.durationMin, description: i.description })),
      },
      createdBy: ctx.user.id,
      createdByName: ctx.user.name,
    })
    .returning({ id: scheduleTemplates.id });
  await audit(tx, ctx, { action: "schedule_template.created", summary: `Saved "${input.name}" as a schedule template`, entityType: "schedule_template", entityId: t!.id });
  return t!.id;
}

export async function archiveTemplate(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "schedules.manage", "manage templates");
  const [t] = await tx.update(scheduleTemplates).set({ archivedAt: new Date() }).where(eq(scheduleTemplates.id, id)).returning();
  if (!t) throw notFound("That template");
  await audit(tx, ctx, { action: "schedule_template.removed", summary: `Removed the schedule template "${t.name}"`, entityType: "schedule_template", entityId: id });
}

export const startSchema = z.object({
  from: z.enum(["blank", "template", "copy"]),
  templateId: optUuid,
  copyOf: optUuid,
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date."),
  branchId: z.string().uuid("Choose a branch."),
});

/** Starts a new draft from scratch, a template, or an earlier schedule. */
export async function startSchedule(tx: Tx, ctx: Actor, input: z.output<typeof startSchema>) {
  assertCan(ctx, "schedules.manage", "create schedules");
  if (input.from === "copy") {
    if (!input.copyOf) throw new AppError("Choose a schedule to copy.", { copyOf: "Choose a schedule." });
    return duplicateSchedule(tx, ctx, input.copyOf, input.serviceDate);
  }
  let body: ScheduleTemplateBody = { title: "Service", startTime: "08:00", items: [] };
  let serviceType: ScheduleType = "sunday";
  if (input.from === "template") {
    const [t] = input.templateId ? await tx.select().from(scheduleTemplates).where(eq(scheduleTemplates.id, input.templateId)) : [];
    if (!t) throw new AppError("Choose a template.", { templateId: "Choose a template." });
    body = t.body;
    serviceType = t.serviceType;
  }
  const r = await saveSchedule(tx, ctx, {
    id: randomUUID(),
    branchId: input.branchId,
    title: input.from === "blank" ? "New service" : body.title,
    serviceType,
    typeLabel: null,
    serviceDate: input.serviceDate,
    startTime: body.startTime,
    endTime: body.endTime ?? null,
    venue: body.venue ?? null,
    theme: null,
    scripture: null,
    presidingName: null,
    presidingMemberId: null,
    announcements: body.announcements ?? null,
    internalNotes: null,
    items: body.items.map((i) => ({ title: i.title, startTime: null, durationMin: i.durationMin ?? null, description: i.description ?? null, notes: null, custom: [], assignees: [] })),
  });
  return r.id;
}

/* ================= people search for assignments ================= */

/** Members, staff and groups, by name. Coordinators may not have access to the member list, so this is its own search. */
export async function searchPeople(tx: Tx, ctx: Actor, q: string) {
  assertCan(ctx, "schedules.manage", "assign people");
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const m = await tx
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, title: members.title, memberNo: members.memberNo })
    .from(members)
    .where(
      and(
        isNull(members.deletedAt),
        eq(members.status, "active"),
        branchScope(ctx, members.branchId),
        or(ilike(members.firstName, like), ilike(members.lastName, like), sql`(${members.firstName} || ' ' || ${members.lastName}) ilike ${like}`),
      ),
    )
    .orderBy(asc(members.firstName))
    .limit(8);
  const u = await tx
    .select({ id: users.id, name: users.name, title: memberships.title, role: roles.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.status, "active"), ilike(users.name, like)))
    .limit(5);
  const g = await tx
    .select({ id: groups.id, name: groups.name, kind: groups.kind })
    .from(groups)
    .where(and(ilike(groups.name, like), isNull(groups.archivedAt)))
    .limit(4);
  return [
    ...u.map((x) => ({ kind: "user" as const, id: x.id, name: x.name, hint: x.title ?? x.role })),
    ...m.map((x) => ({ kind: "member" as const, id: x.id, name: [x.title, x.firstName, x.lastName].filter(Boolean).join(" "), hint: x.memberNo })),
    ...g.map((x) => ({ kind: "group" as const, id: x.id, name: x.name, hint: x.kind === "cell" ? "Home cell" : x.kind === "department" ? "Department" : "Ministry" })),
  ];
}

/* ================= public share page ================= */

export async function publicSchedule(token: string) {
  const [l] = await db.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!l || l.kind !== "schedule" || l.revokedAt || (l.expiresAt && l.expiresAt < new Date()) || !l.targetId) return null;
  return withOrg(l.orgId, async (tx) => {
    const [s] = await tx.select().from(serviceSchedules).where(and(eq(serviceSchedules.id, l.targetId!), isNull(serviceSchedules.deletedAt)));
    if (!s || !s.currentVersion) return null;
    const [v] = await tx.select().from(scheduleVersions).where(and(eq(scheduleVersions.scheduleId, s.id), eq(scheduleVersions.version, s.currentVersion)));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, l.orgId));
    return { church: o!.name, snap: v!.snapshot, version: v!.version, publishedAt: v!.publishedAt, pdfReady: v!.pdfStatus === "ready", orgId: l.orgId, scheduleId: s.id };
  });
}

export async function publicSchedulePdf(token: string) {
  const s = await publicSchedule(token);
  if (!s) return null;
  return withOrg(s.orgId, (tx) => pdfOfVersion(tx, s.scheduleId, s.version));
}

/* ================= export ================= */

export async function exportSchedules(tx: Tx, ctx: Actor, f: ScheduleFilters) {
  assertCan(ctx, "schedules.manage", "export schedules");
  const list = await listSchedules(tx, ctx, { ...f, page: 1 });
  const all: ScheduleRow[] = [...list.rows];
  for (let p = 2; p <= Math.min(40, Math.ceil(list.total / 25)); p++) all.push(...(await listSchedules(tx, ctx, { ...f, page: p })).rows);
  const ids = all.map((r) => r.id);
  const items = ids.length
    ? await tx
        .select({ scheduleId: scheduleItems.scheduleId, position: scheduleItems.position, title: scheduleItems.title, startTime: scheduleItems.startTime, durationMin: scheduleItems.durationMin, id: scheduleItems.id })
        .from(scheduleItems)
        .where(inArray(scheduleItems.scheduleId, ids))
        .orderBy(asc(scheduleItems.position))
    : [];
  const asg = ids.length ? await tx.select().from(scheduleAssignments).where(inArray(scheduleAssignments.scheduleId, ids)) : [];
  await audit(tx, ctx, { action: "schedule.exported", summary: `Exported ${all.length} service schedule${all.length === 1 ? "" : "s"}`, entityType: "schedule" });
  return all.flatMap((s): Record<string, string | number>[] => {
    const its = items.filter((i) => i.scheduleId === s.id);
    const base = {
      Date: s.serviceDate,
      Service: s.title,
      Type: typeLabelOf(s),
      Branch: s.branchName,
      Venue: s.venue ?? "",
      Status: s.status,
      Version: s.currentVersion,
    };
    if (!its.length) return [{ ...base, "#": "", Item: "", Time: "", Minutes: "", Assigned: "" }];
    return its.map((i) => ({
      ...base,
      "#": i.position,
      Item: i.title,
      Time: i.startTime ?? "",
      Minutes: i.durationMin ?? "",
      Assigned: asg
        .filter((a) => a.itemId === i.id)
        .map((a) => a.name)
        .join(", "),
    }));
  });
}
