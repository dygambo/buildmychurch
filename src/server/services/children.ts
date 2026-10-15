import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import {
  branches,
  childCheckins,
  childEvents,
  childGuardians,
  children,
  guardians,
  organisations,
  services,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken, sha256 } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { formatPhone, normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";

/* ---------- classes by age ---------- */

export const CLASS_GROUPS = [
  { name: "Crèche", maxAge: 1 },
  { name: "Nursery", maxAge: 4 },
  { name: "Primary", maxAge: 8 },
  { name: "Juniors", maxAge: 12 },
  { name: "Teens", maxAge: 17 },
] as const;

export function ageOn(dob: string, today = new Date()) {
  const [y, m, d] = dob.split("-").map(Number);
  const lagos = new Date(today.getTime() + 3600_000);
  let age = lagos.getUTCFullYear() - y!;
  if (lagos.getUTCMonth() + 1 < m! || (lagos.getUTCMonth() + 1 === m! && lagos.getUTCDate() < d!)) age--;
  return age;
}
export function classFor(dob: string, today = new Date()) {
  const age = ageOn(dob, today);
  return CLASS_GROUPS.find((c) => age <= c.maxAge)?.name ?? "Teens";
}

/* ---------- validation ---------- */

const opt = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => v || null);

export const guardianSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || undefined),
    memberId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || undefined),
    title: opt,
    firstName: z.string().trim().min(1, "Enter the first name.").max(80),
    lastName: z.string().trim().min(1, "Enter the surname.").max(80),
    phone: z.string().trim().optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email address."),
    relationship: z.string().trim().min(2, "Say how they're related, e.g. Mother.").max(40),
    isPrimary: z.boolean().default(false),
    canPickUp: z.boolean().default(true),
    notify: z.boolean().default(true),
  })
  .superRefine((g, c) => {
    if (g.phone && !normalizeNgPhone(g.phone))
      c.addIssue({ code: "custom", path: ["phone"], message: "Enter a Nigerian number." });
  });

export const childSchema = z
  .object({
    branchId: z.string().uuid("Choose a branch."),
    firstName: z.string().trim().min(1, "Enter the child's first name.").max(80),
    middleName: opt,
    lastName: z.string().trim().min(1, "Enter the child's surname.").max(80),
    gender: z.enum(["male", "female"], { message: "Choose boy or girl." }),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth."),
    classGroup: opt,
    allergies: opt,
    medical: opt,
    specialNeeds: opt,
    notes: opt,
    photoConsent: z.boolean().default(false),
    guardians: z.array(guardianSchema).min(1, "Add at least one parent or guardian.").max(6),
  })
  .superRefine((c, ctx) => {
    const age = ageOn(c.dob);
    if (new Date(c.dob) > new Date())
      ctx.addIssue({ code: "custom", path: ["dob"], message: "That date is in the future." });
    else if (age > 17)
      ctx.addIssue({
        code: "custom",
        path: ["dob"],
        message: "Children's records are for under-18s. Add older people as members.",
      });
    if (!c.guardians.some((g) => g.canPickUp))
      ctx.addIssue({
        code: "custom",
        path: ["guardians"],
        message: "At least one guardian must be allowed to pick the child up.",
      });
    const primary = c.guardians.find((g) => g.isPrimary) ?? c.guardians[0]!;
    if (!primary.phone)
      ctx.addIssue({
        code: "custom",
        path: ["guardians", 0, "phone"],
        message: "The main guardian needs a phone number.",
      });
  });
export type ChildInput = z.input<typeof childSchema>;

/* ---------- registration ---------- */

async function nextChildNo(tx: Tx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"child_no:" + orgId}))`);
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(nullif(regexp_replace(${children.childNo}, '\\D', '', 'g'), '')::int), 0)` })
    .from(children);
  return `C${String(Number(row?.n ?? 0) + 1).padStart(5, "0")}`;
}

async function saveGuardians(tx: Tx, ctx: Actor, childId: string, list: z.output<typeof guardianSchema>[]) {
  const primaryIdx = Math.max(
    0,
    list.findIndex((g) => g.isPrimary),
  );
  const links: (typeof childGuardians.$inferInsert)[] = [];
  for (const [i, g] of list.entries()) {
    const phone = g.phone ? normalizeNgPhone(g.phone) : null;
    const values = {
      memberId: g.memberId ?? null,
      title: g.title,
      firstName: g.firstName,
      lastName: g.lastName,
      phoneEnc: encrypt(phone),
      phoneHash: blindIndex(phone),
      emailEnc: encrypt(g.email || null),
      emailHash: blindIndex(g.email || null),
    };
    let gid = g.id;
    if (!gid && phone) {
      // siblings share parents: reuse a guardian already on record with this phone number and name
      const [same] = await tx
        .select({ id: guardians.id, firstName: guardians.firstName })
        .from(guardians)
        .where(eq(guardians.phoneHash, blindIndex(phone)!));
      if (same && same.firstName.toLowerCase() === g.firstName.toLowerCase()) gid = same.id;
    }
    if (gid) await tx.update(guardians).set(values).where(eq(guardians.id, gid));
    else {
      const [row] = await tx
        .insert(guardians)
        .values({ ...values, orgId: ctx.org.id })
        .returning({ id: guardians.id });
      gid = row!.id;
    }
    if (links.some((l) => l.guardianId === gid)) continue;
    links.push({
      orgId: ctx.org.id,
      childId,
      guardianId: gid,
      relationship: g.relationship,
      isPrimary: i === primaryIdx,
      canPickUp: g.canPickUp,
      notify: g.notify,
    });
  }
  await tx.delete(childGuardians).where(eq(childGuardians.childId, childId));
  await tx.insert(childGuardians).values(links);
}

export async function registerChild(tx: Tx, ctx: Actor, input: ChildInput) {
  assertCan(ctx, "children.manage", "register children");
  const v = childSchema.parse(input);
  assertBranch(ctx, v.branchId);
  const childNo = await nextChildNo(tx, ctx.org.id);
  const [c] = await tx
    .insert(children)
    .values({
      orgId: ctx.org.id,
      branchId: v.branchId,
      childNo,
      firstName: v.firstName,
      middleName: v.middleName,
      lastName: v.lastName,
      gender: v.gender,
      dob: v.dob,
      classGroup: v.classGroup,
      allergiesEnc: encrypt(v.allergies),
      medicalEnc: encrypt(v.medical),
      specialNeedsEnc: encrypt(v.specialNeeds),
      notes: v.notes,
      photoConsent: v.photoConsent,
      qrToken: randomToken(16),
      createdBy: ctx.user.id,
    })
    .returning({ id: children.id });
  await saveGuardians(tx, ctx, c!.id, v.guardians);
  await audit(tx, ctx, {
    action: "child.registered",
    summary: `Registered ${v.firstName} ${v.lastName} (${childNo}) with ${v.guardians.length} guardian${v.guardians.length === 1 ? "" : "s"}`,
    entityType: "child",
    entityId: c!.id,
  });
  return { id: c!.id, childNo };
}

export async function updateChild(tx: Tx, ctx: Actor, id: string, input: ChildInput) {
  assertCan(ctx, "children.manage", "edit children");
  const v = childSchema.parse(input);
  const [before] = await tx
    .select()
    .from(children)
    .where(and(eq(children.id, id), isNull(children.deletedAt)));
  if (!before) throw notFound("That child");
  assertBranch(ctx, before.branchId);
  const medical = ctx.can("children.read_medical");
  await tx
    .update(children)
    .set({
      branchId: v.branchId,
      firstName: v.firstName,
      middleName: v.middleName,
      lastName: v.lastName,
      gender: v.gender,
      dob: v.dob,
      classGroup: v.classGroup,
      notes: v.notes,
      photoConsent: v.photoConsent,
      // people who can't see medical notes can't overwrite them
      ...(medical
        ? {
            allergiesEnc: encrypt(v.allergies),
            medicalEnc: encrypt(v.medical),
            specialNeedsEnc: encrypt(v.specialNeeds),
          }
        : {}),
    })
    .where(eq(children.id, id));
  await saveGuardians(tx, ctx, id, v.guardians);
  await audit(tx, ctx, {
    action: "child.updated",
    summary: `Updated ${v.firstName} ${v.lastName}'s record`,
    entityType: "child",
    entityId: id,
  });
}

export async function rotateQr(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "children.manage", "replace QR tags");
  const [c] = await tx.select().from(children).where(eq(children.id, id));
  if (!c) throw notFound("That child");
  await tx
    .update(children)
    .set({ qrToken: randomToken(16) })
    .where(eq(children.id, id));
  await audit(tx, ctx, {
    action: "child.qr_replaced",
    summary: `Replaced ${c.firstName} ${c.lastName}'s QR tag (the old tag no longer works)`,
    entityType: "child",
    entityId: id,
  });
}

export async function archiveChild(tx: Tx, ctx: Actor, id: string, status: "active" | "graduated" | "inactive") {
  assertCan(ctx, "children.manage", "edit children");
  const [c] = await tx.select().from(children).where(eq(children.id, id));
  if (!c) throw notFound("That child");
  await tx.update(children).set({ status }).where(eq(children.id, id));
  await audit(tx, ctx, {
    action: "child.status",
    summary: `${c.firstName} ${c.lastName} marked ${status}`,
    entityType: "child",
    entityId: id,
  });
}

/* ---------- reading ---------- */

const inChurch = sql<boolean>`exists (select 1 from ${childCheckins} cc where cc.child_id = children.id and cc.checked_out_at is null)`;

export async function listChildren(
  tx: Tx,
  ctx: Actor,
  f: { q?: string; classGroup?: string; status?: string; here?: boolean } = {},
) {
  if (!ctx.can("children.manage") && !ctx.can("children.checkin")) assertCan(ctx, "children.manage");
  const where: (SQL | undefined)[] = [isNull(children.deletedAt), branchScope(ctx, children.branchId)];
  where.push(eq(children.status, (f.status as "active") || "active"));
  if (f.classGroup) where.push(eq(children.classGroup, f.classGroup));
  if (f.here) where.push(inChurch);
  const q = f.q?.trim();
  if (q) {
    const phone = normalizeNgPhone(q);
    where.push(
      or(
        ilike(sql`${children.firstName} || ' ' || ${children.lastName}`, `%${q}%`),
        ilike(children.childNo, `%${q}%`),
        // find children by a parent's name or phone
        inArray(
          children.id,
          sql`(select cg.child_id from ${childGuardians} cg join ${guardians} g on g.id = cg.guardian_id
               where (g.first_name || ' ' || g.last_name) ilike ${"%" + q + "%"} ${phone ? sql`or g.phone_hash = ${blindIndex(phone)}` : sql``})`,
        ),
      ),
    );
  }
  const rows = await tx
    .select({
      id: children.id,
      childNo: children.childNo,
      firstName: children.firstName,
      lastName: children.lastName,
      gender: children.gender,
      dob: children.dob,
      classGroup: children.classGroup,
      hasAllergies: sql<boolean>`${children.allergiesEnc} is not null or ${children.medicalEnc} is not null`,
      here: inChurch,
    })
    .from(children)
    .where(and(...where))
    .orderBy(asc(children.firstName), asc(children.lastName))
    .limit(500);
  const ids = rows.map((r) => r.id);
  const gs = ids.length
    ? await tx
        .select({
          childId: childGuardians.childId,
          firstName: guardians.firstName,
          lastName: guardians.lastName,
          title: guardians.title,
          relationship: childGuardians.relationship,
          isPrimary: childGuardians.isPrimary,
        })
        .from(childGuardians)
        .innerJoin(guardians, eq(guardians.id, childGuardians.guardianId))
        .where(inArray(childGuardians.childId, ids))
    : [];
  return rows.map((r) => ({
    ...r,
    classGroup: r.classGroup ?? classFor(String(r.dob)),
    age: ageOn(String(r.dob)),
    guardians: gs.filter((g) => g.childId === r.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
  }));
}

export async function getChild(tx: Tx, ctx: Actor, id: string) {
  if (!ctx.can("children.manage") && !ctx.can("children.checkin")) assertCan(ctx, "children.manage");
  const [c] = await tx
    .select({ c: children, branchName: branches.name })
    .from(children)
    .innerJoin(branches, eq(branches.id, children.branchId))
    .where(and(eq(children.id, id), isNull(children.deletedAt)));
  if (!c) throw notFound("That child");
  assertBranch(ctx, c.c.branchId);
  const medical = ctx.can("children.read_medical");
  const gs = await tx
    .select({ g: guardians, l: childGuardians })
    .from(childGuardians)
    .innerJoin(guardians, eq(guardians.id, childGuardians.guardianId))
    .where(eq(childGuardians.childId, id))
    .orderBy(desc(childGuardians.isPrimary));
  const [open] = await tx
    .select()
    .from(childCheckins)
    .where(and(eq(childCheckins.childId, id), isNull(childCheckins.checkedOutAt)));
  const recent = await checkinRows(tx, ctx, { childId: id, limit: 20 });
  const r = c.c;
  return {
    id: r.id,
    childNo: r.childNo,
    branchId: r.branchId,
    branchName: c.branchName,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    gender: r.gender,
    dob: String(r.dob),
    age: ageOn(String(r.dob)),
    classGroup: r.classGroup,
    effectiveClass: r.classGroup ?? classFor(String(r.dob)),
    allergies: medical ? decrypt(r.allergiesEnc) : null,
    medical: medical ? decrypt(r.medicalEnc) : null,
    specialNeeds: medical ? decrypt(r.specialNeedsEnc) : null,
    hasMedical: !!(r.allergiesEnc || r.medicalEnc || r.specialNeedsEnc),
    medicalVisible: medical,
    notes: r.notes,
    photoConsent: r.photoConsent,
    qrToken: r.qrToken,
    status: r.status,
    guardians: gs.map(({ g, l }) => ({
      id: g.id,
      memberId: g.memberId,
      title: g.title,
      firstName: g.firstName,
      lastName: g.lastName,
      phone: decrypt(g.phoneEnc),
      email: decrypt(g.emailEnc),
      relationship: l.relationship,
      isPrimary: l.isPrimary,
      canPickUp: l.canPickUp,
      notify: l.notify,
    })),
    open: open
      ? { id: open.id, checkedInAt: open.checkedInAt, securityCode: open.securityCode, classGroup: open.classGroup }
      : null,
    recent,
  };
}
export type ChildDetail = Awaited<ReturnType<typeof getChild>>;

export async function childIdByQr(tx: Tx, token: string) {
  const clean = token.trim().replace(/^BMC-CHILD:/, "");
  const [c] = await tx
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.qrToken, clean), isNull(children.deletedAt)));
  return c?.id ?? null;
}

/* ---------- the tamper-evident chain ---------- */

const GENESIS = "0".repeat(64);
/** Stable JSON: keys sorted, so the same data always hashes the same way. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
const eventHash = (prev: string, e: { childId: string; checkinId: string; type: string; at: string; data: unknown }) =>
  sha256(prev + canonical({ childId: e.childId, checkinId: e.checkinId, type: e.type, at: e.at, data: e.data }));

async function appendEvent(
  tx: Tx,
  orgId: string,
  e: { childId: string; checkinId: string; type: "check_in" | "check_out"; at: Date; data: Record<string, unknown> },
) {
  // one writer at a time per church, so the chain never forks
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"child_chain:" + orgId}))`);
  const [last] = await tx.select({ hash: childEvents.hash }).from(childEvents).orderBy(desc(childEvents.seq)).limit(1);
  const prevHash = last?.hash ?? GENESIS;
  const at = e.at.toISOString();
  const hash = eventHash(prevHash, { ...e, at });
  const [row] = await tx
    .insert(childEvents)
    .values({ orgId, childId: e.childId, checkinId: e.checkinId, type: e.type, at: e.at, data: e.data, prevHash, hash })
    .returning({ seq: childEvents.seq });
  return { seq: row!.seq, hash };
}

/** Recomputes every hash. Any edited, inserted or deleted record shows up as a break. */
export async function verifyChain(tx: Tx, ctx: Actor) {
  assertCan(ctx, "children.manage", "verify check-in records");
  const rows = await tx.select().from(childEvents).orderBy(asc(childEvents.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const expected = eventHash(prev, {
      childId: r.childId,
      checkinId: r.checkinId,
      type: r.type,
      at: r.at.toISOString(),
      data: r.data,
    });
    if (r.prevHash !== prev || r.hash !== expected)
      return { ok: false as const, count: rows.length, brokenAt: r.seq, brokenOn: r.at };
    prev = r.hash;
  }
  return { ok: true as const, count: rows.length, head: prev };
}

/* ---------- check-in and check-out ---------- */

// no 0/O, 1/I/L: easy to read aloud and off a slip
const CODE_CHARS = "ACDEFGHJKMNPQRTUVWXY34679";
function securityCode() {
  return Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
}

async function loadForDesk(tx: Tx, childId: string) {
  const [c] = await tx
    .select()
    .from(children)
    .where(and(eq(children.id, childId), isNull(children.deletedAt)));
  if (!c) throw notFound("That child");
  if (c.status !== "active")
    throw new AppError(`${c.firstName}'s record is marked ${c.status}. Reactivate it to check them in.`);
  const gs = await tx
    .select({ g: guardians, l: childGuardians })
    .from(childGuardians)
    .innerJoin(guardians, eq(guardians.id, childGuardians.guardianId))
    .where(eq(childGuardians.childId, childId));
  return { c, gs };
}

function staffOf(ctx: Actor) {
  return { id: ctx.user.id, name: ctx.user.name, role: ctx.membership.roleName, phone: ctx.membership.phone };
}

export async function checkInChild(
  tx: Tx,
  ctx: Actor,
  input: { childId: string; droppedOffBy: string; method: "qr" | "manual"; serviceId?: string | null },
) {
  assertCan(ctx, "children.checkin", "check children in");
  const { c, gs } = await loadForDesk(tx, input.childId);
  assertBranch(ctx, c.branchId);
  const g = gs.find((x) => x.g.id === input.droppedOffBy);
  if (!g)
    throw new AppError("Choose who is dropping the child off from their guardians.", {
      droppedOffBy: "Choose a guardian.",
    });
  const [open] = await tx
    .select({ id: childCheckins.id, at: childCheckins.checkedInAt })
    .from(childCheckins)
    .where(and(eq(childCheckins.childId, c.id), isNull(childCheckins.checkedOutAt)));
  if (open) throw new AppError(`${c.firstName} is already checked in. Check them out first.`);
  let serviceName: string | null = null;
  if (input.serviceId) {
    const [s] = await tx.select({ name: services.name }).from(services).where(eq(services.id, input.serviceId));
    serviceName = s?.name ?? null;
  }
  const code = securityCode();
  const at = new Date();
  const classGroup = c.classGroup ?? classFor(String(c.dob));
  const staff = staffOf(ctx);
  const [row] = await tx
    .insert(childCheckins)
    .values({
      orgId: ctx.org.id,
      childId: c.id,
      serviceId: input.serviceId ?? null,
      classGroup,
      securityCode: code,
      checkedInAt: at,
      checkedInBy: ctx.user.id,
      checkedInByName: ctx.user.name,
      droppedOffBy: g.g.id,
      checkInMethod: input.method,
    })
    .returning({ id: childCheckins.id });
  const guardianName = `${g.g.title ? g.g.title + " " : ""}${g.g.firstName} ${g.g.lastName}`;
  const ev = await appendEvent(tx, ctx.org.id, {
    childId: c.id,
    checkinId: row!.id,
    type: "check_in",
    at,
    data: {
      child: `${c.firstName} ${c.lastName}`,
      childNo: c.childNo,
      classGroup,
      service: serviceName,
      method: input.method,
      staff,
      guardian: { id: g.g.id, name: guardianName, relationship: g.l.relationship },
    },
  });
  await notifyGuardians(tx, ctx, {
    seq: ev.seq,
    type: "check_in",
    child: c,
    gs,
    at,
    classGroup,
    serviceName,
    staff,
    guardian: { name: guardianName, relationship: g.l.relationship },
    code,
  });
  return { checkinId: row!.id, securityCode: code, classGroup, childName: `${c.firstName} ${c.lastName}` };
}

export async function checkOutChild(
  tx: Tx,
  ctx: Actor,
  input: {
    childId: string;
    pickedUpBy: string;
    method: "qr" | "manual" | "code";
    securityCode?: string;
    overrideReason?: string;
  },
) {
  assertCan(ctx, "children.checkin", "check children out");
  const { c, gs } = await loadForDesk(tx, input.childId);
  assertBranch(ctx, c.branchId);
  const [open] = await tx
    .select()
    .from(childCheckins)
    .where(and(eq(childCheckins.childId, c.id), isNull(childCheckins.checkedOutAt)))
    .for("update");
  if (!open) throw new AppError(`${c.firstName} isn't checked in.`);
  if (input.method === "code" && input.securityCode?.trim().toUpperCase() !== open.securityCode)
    throw new AppError("That pickup code doesn't match. Check the parent's slip, or verify them another way.", {
      securityCode: "Doesn't match.",
    });
  const g = gs.find((x) => x.g.id === input.pickedUpBy);
  if (!g) throw new AppError("Choose who is picking the child up.", { pickedUpBy: "Choose a guardian." });
  const override = input.overrideReason?.trim();
  if (!g.l.canPickUp) {
    if (!override)
      throw new AppError(
        `${g.g.firstName} isn't on ${c.firstName}'s pickup list. Contact the main guardian, or record why you're releasing the child.`,
        {
          overrideReason: "Required to release the child to someone not on the pickup list.",
        },
      );
    if (!ctx.can("children.manage"))
      throw new AppError("Only a children's ministry lead can release a child to someone not on the pickup list.");
  }
  const at = new Date();
  const staff = staffOf(ctx);
  await tx
    .update(childCheckins)
    .set({
      checkedOutAt: at,
      checkedOutBy: ctx.user.id,
      checkedOutByName: ctx.user.name,
      pickedUpBy: g.g.id,
      checkOutMethod: input.method,
      overrideReason: !g.l.canPickUp ? override : null,
    })
    .where(eq(childCheckins.id, open.id));
  const guardianName = `${g.g.title ? g.g.title + " " : ""}${g.g.firstName} ${g.g.lastName}`;
  const ev = await appendEvent(tx, ctx.org.id, {
    childId: c.id,
    checkinId: open.id,
    type: "check_out",
    at,
    data: {
      child: `${c.firstName} ${c.lastName}`,
      childNo: c.childNo,
      method: input.method,
      staff,
      guardian: { id: g.g.id, name: guardianName, relationship: g.l.relationship, onPickupList: g.l.canPickUp },
      override: !g.l.canPickUp ? override : undefined,
    },
  });
  await notifyGuardians(tx, ctx, {
    seq: ev.seq,
    type: "check_out",
    child: c,
    gs,
    at,
    classGroup: open.classGroup ?? "",
    serviceName: null,
    staff,
    guardian: { name: guardianName, relationship: g.l.relationship },
    override: !g.l.canPickUp ? override : undefined,
  });
  if (!g.l.canPickUp)
    await audit(tx, ctx, {
      action: "child.released_override",
      summary: `Released ${c.firstName} ${c.lastName} to ${guardianName}, who is not on the pickup list. Reason: ${override}`,
      entityType: "child",
      entityId: c.id,
    });
  return { childName: `${c.firstName} ${c.lastName}`, guardianName };
}

/** Undo an accidental check-in within 10 minutes. The chain keeps a record of both steps. */
export async function cancelCheckIn(tx: Tx, ctx: Actor, childId: string) {
  assertCan(ctx, "children.checkin", "check children in");
  const [open] = await tx
    .select()
    .from(childCheckins)
    .where(and(eq(childCheckins.childId, childId), isNull(childCheckins.checkedOutAt)));
  if (!open) throw new AppError("This child isn't checked in.");
  if (Date.now() - open.checkedInAt.getTime() > 10 * 60_000)
    throw new AppError("Check-ins can only be cancelled in the first 10 minutes. Check the child out instead.");
  const [c] = await tx.select().from(children).where(eq(children.id, childId));
  const at = new Date();
  await tx
    .update(childCheckins)
    .set({
      checkedOutAt: at,
      checkedOutBy: ctx.user.id,
      checkedOutByName: ctx.user.name,
      checkOutMethod: "manual",
      overrideReason: "Check-in cancelled (made in error)",
    })
    .where(eq(childCheckins.id, open.id));
  await appendEvent(tx, ctx.org.id, {
    childId,
    checkinId: open.id,
    type: "check_out",
    at,
    data: {
      child: `${c!.firstName} ${c!.lastName}`,
      childNo: c!.childNo,
      method: "cancelled",
      staff: staffOf(ctx),
      cancelled: true,
    },
  });
}

/* ---------- parent emails ---------- */

const timeFmt = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-NG", {
  timeZone: "Africa/Lagos",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

async function notifyGuardians(
  tx: Tx,
  ctx: Actor,
  e: {
    seq: number;
    type: "check_in" | "check_out";
    child: typeof children.$inferSelect;
    gs: { g: typeof guardians.$inferSelect; l: typeof childGuardians.$inferSelect }[];
    at: Date;
    classGroup: string;
    serviceName: string | null;
    staff: { name: string; role: string; phone: string | null };
    guardian: { name: string; relationship: string };
    code?: string;
    override?: string;
  },
) {
  const [org] = await tx
    .select({ name: organisations.name, phone: organisations.phone })
    .from(organisations)
    .where(eq(organisations.id, ctx.org.id));
  const name = e.child.firstName;
  const full = `${e.child.firstName} ${e.child.lastName}`;
  const time = timeFmt.format(e.at);
  const where = `${org!.name}${e.serviceName ? ` (${e.serviceName})` : ""}`;
  const rows: [string, string][] =
    e.type === "check_in"
      ? [
          ["Child", `${full} (${e.child.childNo})`],
          ["Class", e.classGroup],
          ["Checked in at", `${time}, ${dateFmt.format(e.at)}`],
          ["Dropped off by", `${e.guardian.name} (${e.guardian.relationship})`],
          [
            "Checked in by",
            `${e.staff.name}, ${e.staff.role}${e.staff.phone ? `, ${formatPhone(e.staff.phone)}` : ""}`,
          ],
          ["Pickup code", e.code!],
        ]
      : [
          ["Child", `${full} (${e.child.childNo})`],
          ["Checked out at", `${time}, ${dateFmt.format(e.at)}`],
          [
            "Picked up by",
            `${e.guardian.name} (${e.guardian.relationship})${e.override ? " — not on the pickup list" : ""}`,
          ],
          [
            "Checked out by",
            `${e.staff.name}, ${e.staff.role}${e.staff.phone ? `, ${formatPhone(e.staff.phone)}` : ""}`,
          ],
          ...(e.override ? ([["Reason given", e.override]] as [string, string][]) : []),
        ];
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 16px;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 10px 8px 0;color:#5b6884;border-bottom:1px solid #eef1f6;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eef1f6;font-weight:${k === "Pickup code" ? "700;font-family:monospace;font-size:18px;letter-spacing:2px" : "500"}">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
  const subject = e.type === "check_in" ? `${name} was checked in at ${time}` : `${name} was picked up at ${time}`;
  const lead =
    e.type === "check_in"
      ? `${full} was checked in to ${e.classGroup} at ${where}.`
      : `${full} was checked out of children's church at ${org!.name} and released to ${e.guardian.name}.`;
  const warn = `If you don't recognise this${org!.phone ? `, call the church immediately on ${formatPhone(org!.phone)}` : ", contact the church immediately"}.`;
  for (const { g, l } of e.gs) {
    const email = decrypt(g.emailEnc);
    if (!email || !l.notify) continue;
    await enqueue(
      tx,
      "email.send",
      {
        to: email,
        subject,
        html: emailLayout({
          church: org!.name,
          preheader: lead,
          heading: subject,
          bodyHtml:
            p(`Hello ${g.firstName},`) +
            p(lead) +
            table +
            (e.type === "check_in"
              ? p(`Keep the pickup code: the person collecting ${name} will be asked for it.`)
              : "") +
            p(warn),
          footer: `You get these emails because you're listed as ${name}'s ${l.relationship.toLowerCase()} at ${org!.name}.`,
        }),
      },
      // the job runs straight away; the key stops double emails if a request is retried
      { orgId: ctx.org.id, dedupeKey: `child-event:${e.seq}:${g.id}`, maxAttempts: 8 },
    );
  }
}

/* ---------- desk lists and records ---------- */

export async function inChurchNow(tx: Tx, ctx: Actor) {
  if (!ctx.can("children.checkin") && !ctx.can("children.manage")) assertCan(ctx, "children.checkin");
  const rows = await tx
    .select({
      checkinId: childCheckins.id,
      childId: children.id,
      firstName: children.firstName,
      lastName: children.lastName,
      classGroup: childCheckins.classGroup,
      securityCode: childCheckins.securityCode,
      checkedInAt: childCheckins.checkedInAt,
      checkedInByName: childCheckins.checkedInByName,
      hasMedical: sql<boolean>`${children.allergiesEnc} is not null or ${children.medicalEnc} is not null or ${children.specialNeedsEnc} is not null`,
      droppedOff: sql<string>`(select g.first_name || ' ' || g.last_name from ${guardians} g where g.id = child_checkins.dropped_off_by)`,
    })
    .from(childCheckins)
    .innerJoin(children, eq(children.id, childCheckins.childId))
    .where(and(isNull(childCheckins.checkedOutAt), branchScope(ctx, children.branchId)))
    .orderBy(asc(childCheckins.classGroup), asc(children.firstName));
  return rows;
}

export async function checkinRows(
  tx: Tx,
  ctx: Actor,
  f: { from?: string; to?: string; childId?: string; limit?: number },
) {
  const dropped = sql<
    string | null
  >`(select coalesce(g.title || ' ', '') || g.first_name || ' ' || g.last_name || ' (' || cg.relationship || ')' from ${guardians} g left join ${childGuardians} cg on cg.guardian_id = g.id and cg.child_id = ${childCheckins.childId} where g.id = child_checkins.dropped_off_by)`;
  const picked = sql<
    string | null
  >`(select coalesce(g.title || ' ', '') || g.first_name || ' ' || g.last_name || ' (' || coalesce(cg.relationship, 'not linked') || ')' from ${guardians} g left join ${childGuardians} cg on cg.guardian_id = g.id and cg.child_id = ${childCheckins.childId} where g.id = ${childCheckins.pickedUpBy})`;
  return tx
    .select({
      id: childCheckins.id,
      childId: children.id,
      childNo: children.childNo,
      child: sql<string>`${children.firstName} || ' ' || ${children.lastName}`,
      classGroup: childCheckins.classGroup,
      service: services.name,
      checkedInAt: childCheckins.checkedInAt,
      checkedInByName: childCheckins.checkedInByName,
      checkInMethod: childCheckins.checkInMethod,
      droppedOffBy: dropped,
      checkedOutAt: childCheckins.checkedOutAt,
      checkedOutByName: childCheckins.checkedOutByName,
      checkOutMethod: childCheckins.checkOutMethod,
      pickedUpBy: picked,
      overrideReason: childCheckins.overrideReason,
    })
    .from(childCheckins)
    .innerJoin(children, eq(children.id, childCheckins.childId))
    .leftJoin(services, eq(services.id, childCheckins.serviceId))
    .where(
      and(
        branchScope(ctx, children.branchId),
        f.childId ? eq(childCheckins.childId, f.childId) : undefined,
        f.from ? gte(childCheckins.checkedInAt, new Date(`${f.from}T00:00:00+01:00`)) : undefined,
        f.to ? lte(childCheckins.checkedInAt, new Date(`${f.to}T23:59:59.999+01:00`)) : undefined,
      ),
    )
    .orderBy(desc(childCheckins.checkedInAt))
    .limit(f.limit ?? 5000);
}

export async function childStats(tx: Tx, ctx: Actor) {
  const [r] = await tx
    .select({
      registered: sql<number>`count(*) filter (where ${children.status} = 'active')::int`,
      here: sql<number>`count(*) filter (where ${inChurch})::int`,
    })
    .from(children)
    .where(and(isNull(children.deletedAt), branchScope(ctx, children.branchId)));
  return { registered: Number(r?.registered ?? 0), here: Number(r?.here ?? 0) };
}
