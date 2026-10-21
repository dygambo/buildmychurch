import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import { counsellingCases, counsellingSessions, memberships, members, organisations, publicLinks, roles, users, type ChecklistItem } from "../db/schema";
import type { Actor } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken } from "../crypto";
import { AppError, forbidden, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { firstName, formatDate, formatTime, todayISO } from "@/lib/format";
import { normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";

/* ================= reference data ================= */

export const KIND_LABEL = { premarital: "Pre-marital", marital: "Marriage support" } as const;
export const STATUS_LABEL = { enquiry: "New enquiry", active: "In counselling", on_hold: "On hold", completed: "Completed", closed: "Closed" } as const;
export const OUTCOME_LABEL = {
  cleared: "Cleared for the wedding",
  not_cleared: "Not cleared yet",
  reconciled: "Reconciled and doing well",
  referred: "Referred to a specialist",
  withdrew: "The couple withdrew",
  other: "Other",
} as const;

/** The usual pre-marital course in Nigerian churches; counsellors can rename or add sessions. */
export const PREMARITAL_TOPICS = [
  "God's design for marriage",
  "Our backgrounds and expectations",
  "Communication",
  "Handling conflict",
  "Money and finances",
  "Roles and responsibilities",
  "Family and in-laws",
  "Sex and intimacy",
  "Children and parenting",
  "Our spiritual life together",
  "The wedding and the first year",
];

export const MARITAL_TOPICS = [
  "First meeting: listening to both",
  "Communication",
  "Trust and forgiveness",
  "Resolving conflict",
  "Money",
  "Intimacy",
  "Extended family",
  "Review and the way forward",
];

const PREMARITAL_CHECKLIST: Omit<ChecklistItem, "done">[] = [
  { key: "form", label: "Counselling form filled by both" },
  { key: "genotype", label: "Genotype results seen (both)" },
  { key: "medical", label: "HIV and other medical test results seen" },
  { key: "membership", label: "Both have done the membership or foundation class" },
  { key: "baptism", label: "Both are baptised" },
  { key: "parents", label: "Parents or guardians informed and in agreement" },
  { key: "registry", label: "Notice given at the marriage registry" },
  { key: "booking", label: "Wedding date booked with the church" },
];

/* ================= access ================= */

/** Pastors (oversee) see every couple; counsellors see the couples assigned to them. */
export const oversees = (ctx: Pick<Actor, "can">) => ctx.can("counselling.oversee");
const counsels = (ctx: Pick<Actor, "can">) => ctx.can("counselling.manage") || oversees(ctx);

function assertCounsellor(ctx: Actor) {
  if (!counsels(ctx)) throw forbidden("work with marriage counselling");
}

type CaseRow = typeof counsellingCases.$inferSelect;
function canSee(ctx: Actor, c: Pick<CaseRow, "counsellorIds" | "branchId">) {
  if (ctx.branchIds.length && !ctx.branchIds.includes(c.branchId)) return false;
  return oversees(ctx) || c.counsellorIds.includes(ctx.user.id);
}

async function loadCase(tx: Tx, ctx: Actor, id: string, lock = false) {
  assertCounsellor(ctx);
  const q = tx.select().from(counsellingCases).where(and(eq(counsellingCases.id, id), isNull(counsellingCases.deletedAt)));
  const [c] = lock ? await q.for("update") : await q;
  if (!c || !canSee(ctx, c)) throw notFound("That counselling record");
  return c;
}

/** Everyone who can be given couples: roles with either counselling permission. */
export async function counsellors(tx: Tx, orgId: string) {
  return tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.status, "active"),
        sql`('counselling.manage' = any(${roles.permissions}) or 'counselling.oversee' = any(${roles.permissions}))`,
      ),
    )
    .orderBy(asc(users.name));
}

async function overseers(tx: Tx, orgId: string) {
  return tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active"), sql`'counselling.oversee' = any(${roles.permissions})`));
}

async function nextRef(tx: Tx, orgId: string, kind: "case" | "cert") {
  const year = todayISO().slice(0, 4);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`counselling-ref:${orgId}:${kind}`}))`);
  const col = kind === "case" ? counsellingCases.refNo : counsellingCases.certificateNo;
  const prefix = kind === "case" ? `MC/${year}/` : `MC-CERT/${year}/`;
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(counsellingCases).where(sql`${col} like ${prefix + "%"}`);
  return `${prefix}${String((r?.n ?? 0) + 1).padStart(3, "0")}`;
}

/* ================= couples ================= */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
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
const optDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v || null)
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a date.");
const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Check the email address.")
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => v || null);

const partner = {
  MemberId: optUuid,
  Name: z.string().trim().max(120).optional().default(""),
  Phone: optText(30),
  Email: optEmail,
};

export const caseSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(["premarital", "marital"]),
    branchId: optUuid,
    aMemberId: partner.MemberId,
    aName: partner.Name,
    aPhone: partner.Phone,
    aEmail: partner.Email,
    bMemberId: partner.MemberId,
    bName: partner.Name,
    bPhone: partner.Phone,
    bEmail: partner.Email,
    weddingDate: optDate,
    weddingVenue: optText(200),
    marriedSince: optDate,
    reason: optText(4000),
    plannedSessions: z.coerce.number().int().min(1).max(30).default(8),
    counsellorIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .superRefine((v, c) => {
    if (!v.aMemberId && v.aName.length < 3) c.addIssue({ code: "custom", path: ["aName"], message: "Choose a member or type their full name." });
    if (!v.bMemberId && v.bName.length < 3) c.addIssue({ code: "custom", path: ["bName"], message: "Choose a member or type their full name." });
    if (v.aMemberId && v.aMemberId === v.bMemberId) c.addIssue({ code: "custom", path: ["bName"], message: "Choose two different people." });
  });

async function resolvePartner(tx: Tx, memberId: string | null, name: string, phoneRaw: string | null, email: string | null) {
  const phone = normalizeNgPhone(phoneRaw);
  if (phoneRaw && !phone) throw new AppError("Check the phone numbers.", { aPhone: "Enter a Nigerian number, e.g. 0803 123 4567." });
  if (memberId) {
    const [m] = await tx.select().from(members).where(and(eq(members.id, memberId), isNull(members.deletedAt)));
    if (!m) throw notFound("That member");
    return {
      memberId: m.id,
      name: [m.title, m.firstName, m.lastName].filter(Boolean).join(" "),
      phone: phone ?? decrypt(m.phoneEnc),
      email: email ?? decrypt(m.emailEnc),
      branchId: m.branchId,
    };
  }
  // quietly link to a member with the same phone
  if (phone) {
    const [m] = await tx.select({ id: members.id, branchId: members.branchId }).from(members).where(and(eq(members.phoneHash, blindIndex(phone)!), isNull(members.deletedAt))).limit(1);
    if (m) return { memberId: m.id, name, phone, email, branchId: m.branchId };
  }
  return { memberId: null, name, phone, email, branchId: null as string | null };
}

async function assertCounsellorIds(tx: Tx, orgId: string, ids: string[]) {
  if (!ids.length) return;
  const team = await counsellors(tx, orgId);
  const bad = ids.find((id) => !team.some((t) => t.id === id));
  if (bad) throw new AppError("Choose counsellors from the counselling team (their role needs a counselling permission).", { counsellorIds: "Not on the counselling team." });
}

export async function saveCase(tx: Tx, ctx: Actor, input: z.output<typeof caseSchema>) {
  assertCounsellor(ctx);
  const a = await resolvePartner(tx, input.aMemberId, input.aName, input.aPhone, input.aEmail);
  const b = await resolvePartner(tx, input.bMemberId, input.bName, input.bPhone, input.bEmail);
  const branchId = input.branchId ?? a.branchId ?? b.branchId ?? (await defaultBranch(tx));
  assertBranch(ctx, branchId);
  // counsellors who can't oversee are always on the couples they open
  let counsellorIds = [...new Set(input.counsellorIds)];
  if (!oversees(ctx) && !counsellorIds.includes(ctx.user.id)) counsellorIds = [ctx.user.id, ...counsellorIds].slice(0, 3);
  await assertCounsellorIds(tx, ctx.org.id, counsellorIds);
  const values = {
    kind: input.kind,
    branchId,
    aMemberId: a.memberId,
    aName: a.name,
    aPhoneEnc: encrypt(a.phone),
    aEmailEnc: encrypt(a.email),
    bMemberId: b.memberId,
    bName: b.name,
    bPhoneEnc: encrypt(b.phone),
    bEmailEnc: encrypt(b.email),
    weddingDate: input.kind === "premarital" ? input.weddingDate : null,
    weddingVenue: input.kind === "premarital" ? input.weddingVenue : null,
    marriedSince: input.kind === "marital" ? input.marriedSince : null,
    reasonEnc: encrypt(input.reason),
    plannedSessions: input.plannedSessions,
  };
  const couple = `${a.name} and ${b.name}`;
  if (input.id) {
    const c = await loadCase(tx, ctx, input.id, true);
    if (!oversees(ctx) && JSON.stringify([...c.counsellorIds].sort()) !== JSON.stringify([...counsellorIds].sort()))
      throw new AppError("Only a pastor can change who counsels a couple.");
    await tx.update(counsellingCases).set({ ...values, counsellorIds }).where(eq(counsellingCases.id, c.id));
    await audit(tx, ctx, { action: "counselling.updated", summary: `Updated the counselling record ${c.refNo}`, entityType: "counselling", entityId: c.id });
    return c.id;
  }
  const refNo = await nextRef(tx, ctx.org.id, "case");
  const [c] = await tx
    .insert(counsellingCases)
    .values({
      ...values,
      orgId: ctx.org.id,
      refNo,
      source: "staff",
      status: counsellorIds.length ? "active" : "enquiry",
      counsellorIds,
      checklist: input.kind === "premarital" ? PREMARITAL_CHECKLIST.map((x) => ({ ...x, done: false })) : [],
      createdBy: ctx.user.id,
      createdByName: ctx.user.name,
    })
    .returning({ id: counsellingCases.id });
  await audit(tx, ctx, { action: "counselling.opened", summary: `Opened ${KIND_LABEL[input.kind].toLowerCase()} counselling ${refNo}`, entityType: "counselling", entityId: c!.id });
  await notifyCounsellors(tx, ctx, c!.id, counsellorIds.filter((x) => x !== ctx.user.id), couple);
  return c!.id;
}

async function defaultBranch(tx: Tx) {
  const [b] = await tx.execute<{ id: string }>(sql`select id from branches order by created_at limit 1`);
  return b!.id;
}

async function notifyCounsellors(tx: Tx, ctx: Actor, caseId: string, ids: string[], couple: string) {
  if (!ids.length) return;
  const team = await counsellors(tx, ctx.org.id);
  for (const u of team.filter((t) => ids.includes(t.id)))
    await enqueue(
      tx,
      "email.send",
      {
        to: u.email,
        subject: "You've been asked to counsel a couple",
        html: emailLayout({
          church: ctx.org.name,
          heading: `${esc(ctx.user.name)} asked you to counsel a couple`,
          bodyHtml: p(`You're now a counsellor for ${couple}. Their details and sessions are in Marriage counselling.`),
          button: { label: "Open the record", url: `${env().APP_URL}/counselling/${caseId}` },
        }),
      },
      { orgId: ctx.org.id, dedupeKey: `counsel-assign:${caseId}:${u.id}` },
    );
}

export async function assignCounsellors(tx: Tx, ctx: Actor, input: { id: string; counsellorIds: string[] }) {
  if (!oversees(ctx)) throw forbidden("assign counsellors");
  const c = await loadCase(tx, ctx, input.id, true);
  const ids = [...new Set(input.counsellorIds)].slice(0, 3);
  await assertCounsellorIds(tx, ctx.org.id, ids);
  const added = ids.filter((x) => !c.counsellorIds.includes(x));
  await tx
    .update(counsellingCases)
    .set({ counsellorIds: ids, status: c.status === "enquiry" && ids.length ? "active" : c.status })
    .where(eq(counsellingCases.id, c.id));
  const team = await counsellors(tx, ctx.org.id);
  await audit(tx, ctx, {
    action: "counselling.assigned",
    summary: `Counsellors for ${c.refNo}: ${ids.map((i) => team.find((t) => t.id === i)?.name).filter(Boolean).join(", ") || "none"}`,
    entityType: "counselling",
    entityId: c.id,
  });
  await notifyCounsellors(tx, ctx, c.id, added.filter((x) => x !== ctx.user.id), `${c.aName} and ${c.bName}`);
}

export async function setCaseStatus(tx: Tx, ctx: Actor, input: { id: string; status: "active" | "on_hold" | "closed" }) {
  const c = await loadCase(tx, ctx, input.id, true);
  if (c.status === "completed") throw new AppError("This counselling is completed. Reopen it by starting a new record if the couple comes back.");
  if (input.status === "active" && !c.counsellorIds.length) throw new AppError("Assign a counsellor first.");
  await tx.update(counsellingCases).set({ status: input.status }).where(eq(counsellingCases.id, c.id));
  await audit(tx, ctx, { action: `counselling.${input.status}`, summary: `${c.refNo}: ${STATUS_LABEL[input.status].toLowerCase()}`, entityType: "counselling", entityId: c.id });
}

export async function toggleChecklist(tx: Tx, ctx: Actor, input: { id: string; key: string; done: boolean; note?: string | null }) {
  const c = await loadCase(tx, ctx, input.id, true);
  const item = c.checklist.find((x) => x.key === input.key);
  if (!item) throw notFound("That checklist item");
  const checklist = c.checklist.map((x) => (x.key === input.key ? { ...x, done: input.done, doneAt: input.done ? todayISO() : null, note: input.note ?? x.note ?? null } : x));
  await tx.update(counsellingCases).set({ checklist }).where(eq(counsellingCases.id, c.id));
  await audit(tx, ctx, { action: "counselling.checklist", summary: `${c.refNo}: ${input.done ? "ticked" : "unticked"} "${item.label}"`, entityType: "counselling", entityId: c.id });
}

export async function addChecklistItem(tx: Tx, ctx: Actor, input: { id: string; label: string }) {
  const c = await loadCase(tx, ctx, input.id, true);
  const label = input.label.trim();
  if (label.length < 3) throw new AppError("Describe the requirement.", { label: "e.g. Pastor's interview with both families" });
  const checklist = [...c.checklist, { key: `x${Date.now().toString(36)}`, label, done: false }];
  await tx.update(counsellingCases).set({ checklist }).where(eq(counsellingCases.id, c.id));
  await audit(tx, ctx, { action: "counselling.checklist", summary: `${c.refNo}: added "${label}" to the checklist`, entityType: "counselling", entityId: c.id });
}

/* ================= sessions ================= */

/** "2026-11-20T18:00" typed in Lagos → Date. */
const lagosDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose the date and time.")
  .transform((v) => new Date(`${v}:00+01:00`));

export const sessionSchema = z.object({
  caseId: z.string().uuid(),
  id: z.string().uuid().optional(),
  topic: z.string().trim().min(2, "What will you cover?").max(140),
  startsAt: lagosDateTime,
  durationMin: z.coerce.number().int().min(15).max(240).default(60),
  location: optText(140),
  counsellorId: optUuid,
  notify: z.boolean().default(true),
});

function coupleContacts(c: CaseRow) {
  return [
    { name: c.aName, email: decrypt(c.aEmailEnc), phone: decrypt(c.aPhoneEnc) },
    { name: c.bName, email: decrypt(c.bEmailEnc), phone: decrypt(c.bPhoneEnc) },
  ];
}

async function emailCouple(tx: Tx, orgId: string, c: CaseRow, subject: string, heading: string, body: (first: string) => string, key: string) {
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  for (const [i, person] of coupleContacts(c).entries()) {
    if (!person.email) continue;
    await enqueue(tx, "email.send", { to: person.email, subject, html: emailLayout({ church: o!.name, heading, bodyHtml: body(firstName(person.name)) }) }, { orgId, dedupeKey: `${key}:${i}` });
  }
}

export async function scheduleSession(tx: Tx, ctx: Actor, input: z.output<typeof sessionSchema>) {
  const c = await loadCase(tx, ctx, input.caseId, true);
  if (c.status === "completed" || c.status === "closed") throw new AppError("This counselling has ended. Reopen it to plan more sessions.");
  const counsellorId = input.counsellorId ?? (c.counsellorIds.includes(ctx.user.id) ? ctx.user.id : (c.counsellorIds[0] ?? null));
  if (!counsellorId) throw new AppError("Assign a counsellor first.");
  if (!c.counsellorIds.includes(counsellorId)) throw new AppError("Choose one of this couple's counsellors.", { counsellorId: "Not counselling this couple." });
  const ends = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  const [clash] = await tx
    .select({ id: counsellingSessions.id, start: counsellingSessions.startsAt })
    .from(counsellingSessions)
    .where(
      and(
        eq(counsellingSessions.counsellorId, counsellorId),
        eq(counsellingSessions.status, "scheduled"),
        input.id ? ne(counsellingSessions.id, input.id) : undefined,
        lt(counsellingSessions.startsAt, ends),
        sql`${counsellingSessions.startsAt} + make_interval(mins => ${counsellingSessions.durationMin}) > ${input.startsAt.toISOString()}`,
      ),
    )
    .limit(1);
  if (clash) throw new AppError(`The counsellor already has a session at ${formatTime(clash.start)} that day. Choose another time.`, { startsAt: "Clashes with another session." });
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, counsellorId));
  const values = { topic: input.topic, startsAt: input.startsAt, durationMin: input.durationMin, location: input.location, counsellorId, counsellorName: u?.name ?? null };
  let id = input.id;
  if (id) {
    const [s] = await tx.select().from(counsellingSessions).where(and(eq(counsellingSessions.id, id), eq(counsellingSessions.caseId, c.id)));
    if (!s) throw notFound("That session");
    if (s.status !== "scheduled") throw new AppError("Only upcoming sessions can be moved.");
    await tx.update(counsellingSessions).set({ ...values, remindedAt: null }).where(eq(counsellingSessions.id, id));
  } else {
    const [s] = await tx.insert(counsellingSessions).values({ ...values, orgId: ctx.org.id, caseId: c.id }).returning({ id: counsellingSessions.id });
    id = s!.id;
  }
  if (c.status === "enquiry" || c.status === "on_hold") await tx.update(counsellingCases).set({ status: "active" }).where(eq(counsellingCases.id, c.id));
  await audit(tx, ctx, {
    action: input.id ? "counselling.session_moved" : "counselling.session_planned",
    summary: `${c.refNo}: ${input.id ? "moved" : "planned"} "${input.topic}" for ${formatDate(input.startsAt)}, ${formatTime(input.startsAt)}`,
    entityType: "counselling",
    entityId: c.id,
  });
  if (input.notify)
    await emailCouple(
      tx,
      ctx.org.id,
      c,
      `${input.id ? "New time" : "Counselling session"}: ${formatDate(input.startsAt, "week")}, ${formatTime(input.startsAt)}`,
      input.id ? "Your session has moved" : "Your next counselling session",
      (first) =>
        p(`Dear ${first},`) +
        p(`${input.id ? "Your session is now" : "Your next session is"} on ${formatDate(input.startsAt, "long")} at ${formatTime(input.startsAt)}${input.location ? `, at ${input.location}` : ""}, with ${u?.name ?? "your counsellor"}.`) +
        p(`Topic: ${input.topic}. Please come together and on time.`),
      `counsel-session:${id}:${input.startsAt.getTime()}`,
    );
  return id!;
}

export const recordSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["held", "missed", "cancelled"]),
  attended: z.enum(["both", "a", "b", "neither"]).optional().nullable(),
  notes: optText(8000),
  homework: optText(1000),
});

export async function recordSession(tx: Tx, ctx: Actor, input: z.output<typeof recordSchema>) {
  const [s] = await tx.select().from(counsellingSessions).where(eq(counsellingSessions.id, input.id));
  if (!s) throw notFound("That session");
  const c = await loadCase(tx, ctx, s.caseId);
  if (input.status === "held" && s.startsAt > new Date(Date.now() + 3600_000)) throw new AppError("This session hasn't happened yet. Move it, or record it afterwards.");
  await tx
    .update(counsellingSessions)
    .set({
      status: input.status,
      attended: input.status === "held" ? (input.attended ?? "both") : input.status === "missed" ? "neither" : null,
      notesEnc: encrypt(input.notes),
      homework: input.homework,
    })
    .where(eq(counsellingSessions.id, s.id));
  await audit(tx, ctx, { action: `counselling.session_${input.status}`, summary: `${c.refNo}: "${s.topic}" ${input.status === "held" ? "held" : input.status}`, entityType: "counselling", entityId: c.id });
  if (input.status === "held" && input.homework)
    await emailCouple(
      tx,
      ctx.org.id,
      c,
      `Before your next session: ${s.topic}`,
      "Thank you for coming",
      (first) => p(`Dear ${first}, thank you for today's session on ${s.topic}.`) + p("Before the next one, please:") + `<p style="margin:0 0 12px;padding:10px 12px;background:#f4f6fb;border-radius:8px;white-space:pre-wrap">${esc(input.homework!)}</p>`,
      `counsel-homework:${s.id}`,
    );
}

/* ================= finishing ================= */

export const completeSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["cleared", "not_cleared", "reconciled", "referred", "withdrew", "other"]),
  summary: optText(4000),
  overrideChecklist: z.boolean().default(false),
});

export async function completeCase(tx: Tx, ctx: Actor, input: z.output<typeof completeSchema>) {
  const c = await loadCase(tx, ctx, input.id, true);
  if (c.status === "completed") throw new AppError("This counselling is already completed.");
  if (input.outcome === "cleared") {
    if (c.kind !== "premarital") throw new AppError("Only pre-marital counselling ends with clearing a couple for their wedding.");
    if (!oversees(ctx)) throw new AppError("Only a pastor can clear a couple for their wedding. Choose another outcome or ask a pastor.");
    const open = c.checklist.filter((x) => !x.done);
    if (open.length && !input.overrideChecklist)
      throw new AppError(`${open.length} checklist ${open.length === 1 ? "item is" : "items are"} not ticked: ${open.map((x) => x.label).join("; ")}. Tick them, or confirm you're clearing the couple anyway.`);
  }
  const certificateNo = input.outcome === "cleared" ? await nextRef(tx, ctx.org.id, "cert") : null;
  await tx
    .update(counsellingCases)
    .set({ status: "completed", outcome: input.outcome, summaryEnc: encrypt(input.summary), certificateNo, completedAt: new Date() })
    .where(eq(counsellingCases.id, c.id));
  await tx.update(counsellingSessions).set({ status: "cancelled" }).where(and(eq(counsellingSessions.caseId, c.id), eq(counsellingSessions.status, "scheduled")));
  await audit(tx, ctx, {
    action: "counselling.completed",
    summary: `${c.refNo} completed: ${OUTCOME_LABEL[input.outcome]}${certificateNo ? ` (certificate ${certificateNo})` : ""}${input.overrideChecklist ? ", with checklist items still open" : ""}`,
    entityType: "counselling",
    entityId: c.id,
  });
  if (certificateNo)
    await emailCouple(
      tx,
      ctx.org.id,
      c,
      "Congratulations: you've completed pre-marital counselling",
      "Congratulations!",
      (first) =>
        p(`Dear ${first}, you have completed pre-marital counselling and have been cleared for your wedding${c.weddingDate ? ` on ${formatDate(c.weddingDate, "long")}` : ""}.`) +
        p(`Your certificate number is ${certificateNo}. The church office will give you the signed certificate.`) +
        p("We're praying for a joyful wedding and a marriage that honours God."),
      `counsel-cleared:${c.id}`,
    );
  return certificateNo;
}

/* ================= reading ================= */

export async function listCases(tx: Tx, ctx: Actor, f: { tab?: string; kind?: string; mine?: boolean; q?: string } = {}) {
  assertCounsellor(ctx);
  const tab = ["enquiry", "active", "on_hold", "completed", "closed", "all"].includes(f.tab ?? "") ? f.tab! : "open";
  const rows = await tx
    .select({
      c: counsellingCases,
      held: sql<number>`(select count(*) from counselling_sessions s where s.case_id = counselling_cases.id and s.status = 'held')::int`,
      next: sql<string | null>`(select min(s.starts_at)::text from counselling_sessions s where s.case_id = counselling_cases.id and s.status = 'scheduled' and s.starts_at > now())`,
    })
    .from(counsellingCases)
    .where(
      and(
        isNull(counsellingCases.deletedAt),
        branchScope(ctx, counsellingCases.branchId),
        oversees(ctx) && !f.mine ? undefined : sql`${ctx.user.id}::uuid = any(${counsellingCases.counsellorIds})`,
        tab === "open" ? inArray(counsellingCases.status, ["enquiry", "active", "on_hold"]) : tab === "all" ? undefined : eq(counsellingCases.status, tab as "active"),
        f.kind === "premarital" || f.kind === "marital" ? eq(counsellingCases.kind, f.kind) : undefined,
      ),
    )
    .orderBy(sql`case ${counsellingCases.status} when 'enquiry' then 0 when 'active' then 1 when 'on_hold' then 2 else 3 end`, desc(counsellingCases.createdAt))
    .limit(300);
  const team = await counsellors(tx, ctx.org.id);
  const q = f.q?.trim().toLowerCase();
  return rows
    .map(({ c, held, next }) => ({
      id: c.id,
      refNo: c.refNo,
      kind: c.kind,
      status: c.status,
      couple: `${c.aName} & ${c.bName}`,
      weddingDate: c.weddingDate,
      counsellors: c.counsellorIds.map((i) => team.find((t) => t.id === i)?.name ?? "Former counsellor"),
      held,
      planned: c.plannedSessions,
      next: next ? new Date(next) : null,
      checklistOpen: c.checklist.filter((x) => !x.done).length,
      outcome: c.outcome,
      source: c.source,
      createdAt: c.createdAt,
    }))
    .filter((r) => !q || `${r.couple} ${r.refNo}`.toLowerCase().includes(q));
}
export type CaseListRow = Awaited<ReturnType<typeof listCases>>[number];

export async function getCase(tx: Tx, ctx: Actor, id: string) {
  const c = await loadCase(tx, ctx, id);
  const sessions = await tx.select().from(counsellingSessions).where(eq(counsellingSessions.caseId, c.id)).orderBy(asc(counsellingSessions.startsAt));
  const team = await counsellors(tx, ctx.org.id);
  return {
    id: c.id,
    refNo: c.refNo,
    kind: c.kind,
    status: c.status,
    source: c.source,
    branchId: c.branchId,
    a: { memberId: c.aMemberId, name: c.aName, phone: decrypt(c.aPhoneEnc), email: decrypt(c.aEmailEnc) },
    b: { memberId: c.bMemberId, name: c.bName, phone: decrypt(c.bPhoneEnc), email: decrypt(c.bEmailEnc) },
    weddingDate: c.weddingDate,
    weddingVenue: c.weddingVenue,
    marriedSince: c.marriedSince,
    reason: decrypt(c.reasonEnc),
    summary: decrypt(c.summaryEnc),
    counsellorIds: c.counsellorIds,
    counsellors: c.counsellorIds.map((i) => ({ id: i, name: team.find((t) => t.id === i)?.name ?? "Former counsellor" })),
    checklist: c.checklist,
    plannedSessions: c.plannedSessions,
    outcome: c.outcome,
    certificateNo: c.certificateNo,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    createdByName: c.createdByName,
    sessions: sessions.map((s) => ({ ...s, notes: decrypt(s.notesEnc), notesEnc: undefined })),
    topics: c.kind === "premarital" ? PREMARITAL_TOPICS : MARITAL_TOPICS,
  };
}
export type CaseDetail = Awaited<ReturnType<typeof getCase>>;

/** Sessions in the next two weeks, for the side panel and dashboard. */
export async function upcomingSessions(tx: Tx, ctx: Actor, days = 14) {
  assertCounsellor(ctx);
  const rows = await tx
    .select({ s: counsellingSessions, a: counsellingCases.aName, b: counsellingCases.bName, ids: counsellingCases.counsellorIds, branchId: counsellingCases.branchId })
    .from(counsellingSessions)
    .innerJoin(counsellingCases, eq(counsellingCases.id, counsellingSessions.caseId))
    .where(and(eq(counsellingSessions.status, "scheduled"), gte(counsellingSessions.startsAt, new Date(Date.now() - 3 * 3600_000)), lt(counsellingSessions.startsAt, new Date(Date.now() + days * 86_400_000)), isNull(counsellingCases.deletedAt)))
    .orderBy(asc(counsellingSessions.startsAt));
  return rows
    .filter((r) => canSee(ctx, { counsellorIds: r.ids, branchId: r.branchId }))
    .map((r) => ({ id: r.s.id, caseId: r.s.caseId, couple: `${r.a} & ${r.b}`, topic: r.s.topic, startsAt: r.s.startsAt, location: r.s.location, counsellor: r.s.counsellorName, mine: r.s.counsellorId === ctx.user.id }));
}

/** For the sidebar badge: new enquiries (for pastors) and sessions waiting to be written up (for counsellors). */
export async function counsellingCounts(tx: Tx, ctx: Actor) {
  if (!counsels(ctx)) return { enquiries: 0, toRecord: 0 };
  const [e] = oversees(ctx)
    ? await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(counsellingCases)
        .where(and(eq(counsellingCases.status, "enquiry"), isNull(counsellingCases.deletedAt), branchScope(ctx, counsellingCases.branchId)))
    : [{ n: 0 }];
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(counsellingSessions)
    .where(and(eq(counsellingSessions.counsellorId, ctx.user.id), eq(counsellingSessions.status, "scheduled"), lt(counsellingSessions.startsAt, new Date(Date.now() - 2 * 3600_000))));
  return { enquiries: e?.n ?? 0, toRecord: r?.n ?? 0 };
}

/* ================= public request page ================= */

export async function requestLink(tx: Tx, ctx: Actor) {
  assertCounsellor(ctx);
  const [l] = await tx.select().from(publicLinks).where(and(eq(publicLinks.orgId, ctx.org.id), eq(publicLinks.kind, "counselling"), isNull(publicLinks.revokedAt)));
  if (l) return `${env().APP_URL}/mc/${l.token}`;
  const token = randomToken(9);
  await tx.insert(publicLinks).values({ token, orgId: ctx.org.id, kind: "counselling" });
  return `${env().APP_URL}/mc/${token}`;
}

export async function requestPage(token: string) {
  const [l] = await db.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!l || l.kind !== "counselling" || l.revokedAt) return null;
  const [o] = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(eq(organisations.id, l.orgId));
  return o ?? null;
}

export const publicRequestSchema = z
  .object({
    kind: z.enum(["premarital", "marital"]),
    aName: z.string().trim().min(3, "Enter your full name.").max(120),
    aPhone: z.string().trim().min(7, "Enter your phone number.").max(30),
    aEmail: optEmail,
    bName: z.string().trim().min(3, "Enter their full name.").max(120),
    bPhone: optText(30),
    bEmail: optEmail,
    weddingDate: optDate,
    marriedSince: optDate,
    reason: optText(2000),
  })
  .superRefine((v, c) => {
    if (v.kind === "premarital" && v.weddingDate && v.weddingDate < todayISO()) c.addIssue({ code: "custom", path: ["weddingDate"], message: "Choose a date in the future, or leave it empty." });
  });

/** A couple asks for counselling from the church's request page. Pastors are told without the details. */
export async function submitRequest(token: string, input: z.output<typeof publicRequestSchema>) {
  const org = await requestPage(token);
  if (!org) throw new AppError("This link isn't valid. Ask the church for the right one.");
  const aPhone = normalizeNgPhone(input.aPhone);
  if (!aPhone) throw new AppError("Check your phone number.", { aPhone: "Enter a Nigerian number, e.g. 0803 123 4567." });
  return withOrg(org.id, async (tx) => {
    const a = await resolvePartner(tx, null, input.aName, aPhone, input.aEmail);
    const b = await resolvePartner(tx, null, input.bName, input.bPhone, input.bEmail);
    const refNo = await nextRef(tx, org.id, "case");
    const branchId = a.branchId ?? b.branchId ?? (await defaultBranch(tx));
    const [c] = await tx
      .insert(counsellingCases)
      .values({
        orgId: org.id,
        branchId,
        refNo,
        kind: input.kind,
        status: "enquiry",
        source: "online",
        aMemberId: a.memberId,
        aName: input.aName,
        aPhoneEnc: encrypt(aPhone),
        aEmailEnc: encrypt(input.aEmail),
        bMemberId: b.memberId,
        bName: input.bName,
        bPhoneEnc: encrypt(b.phone),
        bEmailEnc: encrypt(input.bEmail),
        weddingDate: input.kind === "premarital" ? input.weddingDate : null,
        marriedSince: input.kind === "marital" ? input.marriedSince : null,
        reasonEnc: encrypt(input.reason),
        checklist: input.kind === "premarital" ? PREMARITAL_CHECKLIST.map((x) => ({ ...x, done: false })) : [],
        plannedSessions: input.kind === "premarital" ? PREMARITAL_TOPICS.length : 6,
      })
      .returning({ id: counsellingCases.id });
    await audit(tx, { system: "Counselling request page", orgId: org.id }, { action: "counselling.requested", summary: `New ${KIND_LABEL[input.kind].toLowerCase()} counselling request ${refNo}`, entityType: "counselling", entityId: c!.id });
    for (const u of await overseers(tx, org.id))
      await enqueue(
        tx,
        "email.send",
        {
          to: u.email,
          subject: `New ${input.kind === "premarital" ? "pre-marital" : "marriage"} counselling request (${refNo})`,
          html: emailLayout({
            church: org.name,
            heading: "A couple has asked for counselling",
            bodyHtml: p(`A ${input.kind === "premarital" ? "pre-marital" : "marriage support"} counselling request came in from the request page. Open it to read it and assign a counsellor.`),
            button: { label: "Open the request", url: `${env().APP_URL}/counselling/${c!.id}` },
          }),
        },
        { orgId: org.id, dedupeKey: `counsel-request:${c!.id}:${u.id}` },
      );
    for (const [i, person] of [
      { name: input.aName, email: input.aEmail },
      { name: input.bName, email: input.bEmail },
    ].entries())
      if (person.email)
        await enqueue(
          tx,
          "email.send",
          {
            to: person.email,
            subject: "We've received your counselling request",
            html: emailLayout({
              church: org.name,
              heading: `Thank you, ${esc(firstName(person.name))}`,
              bodyHtml:
                p(`We've received your request for ${input.kind === "premarital" ? "pre-marital" : "marriage"} counselling at ${org.name}. A pastor will contact you to arrange your first session.`) +
                p(`Your reference is ${refNo}. Everything you share is kept confidential.`),
            }),
          },
          { orgId: org.id, dedupeKey: `counsel-ack:${c!.id}:${i}` },
        );
    return { refNo, church: org.name };
  });
}

/* ================= reminders ================= */

/** The evening before: reminds the couple of tomorrow's sessions (and what to bring from last time). */
export async function sendSessionReminders(orgId: string, tomorrow: string) {
  return withOrg(orgId, async (tx) => {
    const from = new Date(`${tomorrow}T00:00:00+01:00`);
    const to = new Date(from.getTime() + 86_400_000);
    const due = await tx
      .select({ s: counsellingSessions, c: counsellingCases })
      .from(counsellingSessions)
      .innerJoin(counsellingCases, eq(counsellingCases.id, counsellingSessions.caseId))
      .where(and(eq(counsellingSessions.status, "scheduled"), isNull(counsellingSessions.remindedAt), gte(counsellingSessions.startsAt, from), lt(counsellingSessions.startsAt, to)));
    for (const { s, c } of due) {
      await emailCouple(
        tx,
        orgId,
        c,
        `Tomorrow: counselling at ${formatTime(s.startsAt)}`,
        "See you tomorrow",
        (first) => p(`Dear ${first}, a reminder of your counselling session tomorrow at ${formatTime(s.startsAt)}${s.location ? `, at ${s.location}` : ""}, with ${s.counsellorName ?? "your counsellor"}.`) + p(`Topic: ${s.topic}.`),
        `counsel-remind:${s.id}`,
      );
      await tx.update(counsellingSessions).set({ remindedAt: new Date() }).where(eq(counsellingSessions.id, s.id));
    }
    return due.length;
  });
}

/** Data for the completion certificate. */
export async function certificateData(tx: Tx, ctx: Actor, id: string) {
  const c = await loadCase(tx, ctx, id);
  if (!c.certificateNo) throw new AppError("A certificate is issued when a pastor clears the couple for their wedding.");
  const [o] = await tx.select({ name: organisations.name, address: organisations.address }).from(organisations).where(eq(organisations.id, ctx.org.id));
  const held = await tx.select({ n: sql<number>`count(*)::int` }).from(counsellingSessions).where(and(eq(counsellingSessions.caseId, c.id), eq(counsellingSessions.status, "held")));
  const team = await counsellors(tx, ctx.org.id);
  await audit(tx, ctx, { action: "counselling.certificate", summary: `Printed certificate ${c.certificateNo}`, entityType: "counselling", entityId: c.id });
  return {
    church: o!.name,
    address: o!.address,
    a: c.aName,
    b: c.bName,
    certificateNo: c.certificateNo,
    completedAt: c.completedAt!,
    weddingDate: c.weddingDate,
    sessions: held[0]?.n ?? 0,
    counsellors: c.counsellorIds.map((i) => team.find((t) => t.id === i)?.name).filter(Boolean) as string[],
  };
}
