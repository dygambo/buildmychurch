import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import {
  auditLogs,
  branches,
  consents,
  groupMembers,
  groups,
  households,
  members,
  memberTags,
  tags,
  MEMBER_STATUS,
  STAGES,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit, diff } from "../audit";
import { blindIndex, decrypt, encrypt } from "../crypto";
import { AppError, notFound } from "../errors";
import { localPhone, normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";

/* ---------- validation (shared by the form and by imports) ---------- */

const optText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => v || null);
const optInt = (min: number, max: number, msg: string) =>
  z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
      z.number({ message: msg }).int(msg).min(min, msg).max(max, msg).nullable(),
    )
    .optional()
    .transform((v) => v ?? null);
const optDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a full date.")
  .transform((v) => v || null);

export const memberSchema = z
  .object({
    branchId: z.string().uuid("Choose a branch."),
    title: optText,
    firstName: z.string().trim().min(1, "Enter a first name.").max(80),
    middleName: optText,
    lastName: z.string().trim().min(1, "Enter a surname.").max(80),
    gender: z.enum(["male", "female"], { message: "Choose male or female." }),
    dobDay: optInt(1, 31, "Enter a day from 1 to 31."),
    dobMonth: optInt(1, 12, "Choose a month."),
    dobYear: optInt(1900, new Date().getFullYear(), "Enter a real year."),
    maritalStatus: z
      .enum(["single", "married", "widowed", "divorced", "separated"])
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null),
    anniversary: optDate,
    phone: optText,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email address.")
      .transform((v) => v || null),
    address: optText,
    area: optText,
    occupation: optText,
    employer: optText,
    bloodGroup: optText,
    genotype: optText,
    stage: z.enum(STAGES).default("member"),
    status: z.enum(MEMBER_STATUS).default("active"),
    joinDate: optDate,
    baptism: z.enum(["none", "water", "spirit", "both"]).default("none"),
    foundationSchoolAt: optDate,
    howHeard: optText,
    consentMessaging: z.boolean().default(false),
    consentHealth: z.boolean().default(false),
    consentPhoto: z.boolean().default(false),
    dnd: z.boolean().default(false),
  })
  .superRefine((m, c) => {
    if ((m.dobDay == null) !== (m.dobMonth == null))
      c.addIssue({ code: "custom", path: ["dobDay"], message: "Enter both the day and the month, or neither." });
    if (m.dobDay && m.dobMonth) {
      const max = new Date(Date.UTC(m.dobYear ?? 2000, m.dobMonth, 0)).getUTCDate();
      if (m.dobDay > max) c.addIssue({ code: "custom", path: ["dobDay"], message: "That day isn't in that month." });
    }
    if (m.phone && !normalizeNgPhone(m.phone))
      c.addIssue({ code: "custom", path: ["phone"], message: "Enter a Nigerian number, e.g. 0803 123 4567." });
  });

export type MemberInput = z.input<typeof memberSchema>;
type MemberValues = z.output<typeof memberSchema>;

/* ---------- listing ---------- */

export type MemberFilters = {
  q?: string;
  stage?: string;
  status?: string;
  branchId?: string;
  groupId?: string;
  tagId?: string;
  gender?: string;
  birthdays?: "week" | "month";
  page?: number;
  pageSize?: number;
};

function filterSql(ctx: Actor, f: MemberFilters): SQL | undefined {
  const where: (SQL | undefined)[] = [isNull(members.deletedAt), branchScope(ctx, members.branchId)];
  const q = f.q?.trim();
  if (q) {
    const phone = normalizeNgPhone(q);
    const conds: (SQL | undefined)[] = [
      ilike(
        sql`${members.firstName} || ' ' || coalesce(${members.middleName}, '') || ' ' || ${members.lastName}`,
        `%${q}%`,
      ),
      ilike(sql`${members.lastName} || ' ' || ${members.firstName}`, `%${q}%`),
      ilike(members.memberNo, `%${q}%`),
    ];
    if (phone) conds.push(eq(members.phoneHash, blindIndex(phone)!));
    else if (/^\d{4}$/.test(q)) conds.push(eq(members.phoneLast4, q));
    if (q.includes("@")) conds.push(eq(members.emailHash, blindIndex(q.toLowerCase())!));
    where.push(or(...conds));
  }
  if (f.stage && (STAGES as readonly string[]).includes(f.stage))
    where.push(eq(members.stage, f.stage as (typeof STAGES)[number]));
  if (f.status && (MEMBER_STATUS as readonly string[]).includes(f.status))
    where.push(eq(members.status, f.status as (typeof MEMBER_STATUS)[number]));
  else if (!f.status) where.push(eq(members.status, "active"));
  if (f.branchId) where.push(eq(members.branchId, f.branchId));
  if (f.gender === "male" || f.gender === "female") where.push(eq(members.gender, f.gender));
  if (f.groupId)
    where.push(
      inArray(
        members.id,
        sql`(select ${groupMembers.memberId} from ${groupMembers} where ${groupMembers.groupId} = ${f.groupId})`,
      ),
    );
  if (f.tagId)
    where.push(
      inArray(
        members.id,
        sql`(select ${memberTags.memberId} from ${memberTags} where ${memberTags.tagId} = ${f.tagId})`,
      ),
    );
  if (f.birthdays) where.push(birthdaySql(f.birthdays));
  return and(...where);
}

/** Birthdays in the next 7 days, or in the current month (Lagos time). Handles the year boundary. */
function birthdaySql(range: "week" | "month"): SQL {
  if (range === "month") return sql`${members.dobMonth} = extract(month from (now() at time zone 'Africa/Lagos'))::int`;
  return sql`${members.dobMonth} is not null and exists (
    select 1 from generate_series(0, 6) as g(d)
    where extract(month from ((now() at time zone 'Africa/Lagos')::date + g.d))::int = ${members.dobMonth}
      and extract(day from ((now() at time zone 'Africa/Lagos')::date + g.d))::int = ${members.dobDay})`;
}

export async function listMembers(tx: Tx, ctx: Actor, f: MemberFilters) {
  assertCan(ctx, "members.read", "see members");
  const pageSize = Math.min(f.pageSize ?? 25, 200);
  const page = Math.max(1, f.page ?? 1);
  const where = filterSql(ctx, f);
  const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(members).where(where);
  const rows = await tx
    .select({
      id: members.id,
      memberNo: members.memberNo,
      title: members.title,
      firstName: members.firstName,
      lastName: members.lastName,
      gender: members.gender,
      stage: members.stage,
      status: members.status,
      phoneEnc: members.phoneEnc,
      dobDay: members.dobDay,
      dobMonth: members.dobMonth,
      joinDate: members.joinDate,
      branchName: branches.name,
      branchId: members.branchId,
    })
    .from(members)
    .innerJoin(branches, eq(branches.id, members.branchId))
    .where(where)
    .orderBy(
      ...(f.birthdays
        ? [asc(members.dobMonth), asc(members.dobDay)]
        : [asc(members.lastName), asc(members.firstName)]),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  const groupRows = ids.length
    ? await tx
        .select({ memberId: groupMembers.memberId, name: groups.name, kind: groups.kind })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(inArray(groupMembers.memberId, ids))
    : [];
  return {
    total: Number(n),
    page,
    pageSize,
    rows: rows.map(({ phoneEnc, ...r }) => ({
      ...r,
      phone: decrypt(phoneEnc),
      groups: groupRows.filter((g) => g.memberId === r.id).map((g) => g.name),
    })),
  };
}

/** Fast lookup for pickers (households, group members, leaders). */
export async function searchMembers(tx: Tx, ctx: Actor, q: string, limit = 8) {
  assertCan(ctx, "members.read", "see members");
  if (q.trim().length < 2) return [];
  return tx
    .select({
      id: members.id,
      memberNo: members.memberNo,
      firstName: members.firstName,
      lastName: members.lastName,
      title: members.title,
      householdId: members.householdId,
    })
    .from(members)
    .where(filterSql(ctx, { q }))
    .orderBy(asc(members.firstName))
    .limit(limit);
}

/* ---------- one member ---------- */

export async function getMember(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "members.read", "see members");
  const [m] = await tx
    .select({ m: members, branchName: branches.name })
    .from(members)
    .innerJoin(branches, eq(branches.id, members.branchId))
    .where(and(eq(members.id, id), isNull(members.deletedAt)));
  if (!m) throw notFound("That member");
  assertBranch(ctx, m.m.branchId);
  const sensitive = ctx.can("members.read_sensitive");
  const health = sensitive && m.m.consentHealth;

  const [memberGroups, memberTagRows, household, history] = await Promise.all([
    tx
      .select({ id: groups.id, name: groups.name, kind: groups.kind, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.memberId, id))
      .orderBy(asc(groups.kind), asc(groups.name)),
    tx
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(memberTags)
      .innerJoin(tags, eq(tags.id, memberTags.tagId))
      .where(eq(memberTags.memberId, id))
      .orderBy(asc(tags.name)),
    m.m.householdId
      ? tx
          .select({
            id: members.id,
            title: members.title,
            firstName: members.firstName,
            lastName: members.lastName,
            role: members.householdRole,
            hhName: households.name,
          })
          .from(members)
          .innerJoin(households, eq(households.id, members.householdId))
          .where(and(eq(members.householdId, m.m.householdId), isNull(members.deletedAt)))
          .orderBy(asc(members.householdRole))
      : Promise.resolve([]),
    tx
      .select({
        id: auditLogs.id,
        at: auditLogs.createdAt,
        actorName: auditLogs.actorName,
        summary: auditLogs.summary,
        action: auditLogs.action,
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "member"), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(30),
  ]);
  const r = m.m;
  return {
    id: r.id,
    memberNo: r.memberNo,
    branchId: r.branchId,
    branchName: m.branchName,
    title: r.title,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    gender: r.gender,
    dobDay: r.dobDay,
    dobMonth: r.dobMonth,
    dobYear: r.dobYear,
    maritalStatus: r.maritalStatus,
    anniversary: r.anniversary,
    phone: decrypt(r.phoneEnc),
    email: sensitive ? decrypt(r.emailEnc) : null,
    address: sensitive ? decrypt(r.addressEnc) : null,
    area: r.area,
    occupation: r.occupation,
    employer: r.employer,
    bloodGroup: health ? decrypt(r.bloodGroupEnc) : null,
    genotype: health ? decrypt(r.genotypeEnc) : null,
    stage: r.stage,
    status: r.status,
    joinDate: r.joinDate,
    baptism: r.baptism,
    foundationSchoolAt: r.foundationSchoolAt,
    howHeard: r.howHeard,
    consentMessaging: r.consentMessaging,
    consentHealth: r.consentHealth,
    consentPhoto: r.consentPhoto,
    dnd: r.dnd,
    householdId: r.householdId,
    householdRole: r.householdRole,
    createdAt: r.createdAt,
    sensitiveVisible: sensitive,
    hasHidden: !sensitive && !!(r.emailEnc || r.addressEnc),
    groups: memberGroups,
    tags: memberTagRows,
    household: household.filter((h) => h.id !== id),
    householdName: household[0]?.hhName ?? null,
    history,
  };
}
export type MemberDetail = Awaited<ReturnType<typeof getMember>>;

/* ---------- create / update ---------- */

async function nextMemberNo(tx: Tx, orgId: string) {
  // serialise numbering per church so two people added at once never share a number
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"member_no:" + orgId}))`);
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(nullif(regexp_replace(${members.memberNo}, '\\D', '', 'g'), '')::int), 0)` })
    .from(members);
  return `M${String(Number(row?.n ?? 0) + 1).padStart(5, "0")}`;
}

function toColumns(v: MemberValues) {
  const phone = v.phone ? normalizeNgPhone(v.phone) : null;
  return {
    branchId: v.branchId,
    title: v.title,
    firstName: v.firstName,
    middleName: v.middleName,
    lastName: v.lastName,
    gender: v.gender,
    dobDay: v.dobDay,
    dobMonth: v.dobMonth,
    dobYear: v.dobYear,
    maritalStatus: v.maritalStatus,
    anniversary: v.anniversary,
    phoneEnc: encrypt(phone),
    phoneHash: blindIndex(phone),
    phoneLast4: phone ? phone.slice(-4) : null,
    emailEnc: encrypt(v.email),
    emailHash: blindIndex(v.email),
    addressEnc: encrypt(v.address),
    area: v.area,
    occupation: v.occupation,
    employer: v.employer,
    bloodGroupEnc: v.consentHealth ? encrypt(v.bloodGroup) : null,
    genotypeEnc: v.consentHealth ? encrypt(v.genotype) : null,
    stage: v.stage,
    status: v.status,
    baptism: v.baptism,
    foundationSchoolAt: v.foundationSchoolAt,
    howHeard: v.howHeard,
    consentMessaging: v.consentMessaging,
    consentHealth: v.consentHealth,
    consentPhoto: v.consentPhoto,
    dnd: v.dnd,
    ...(v.joinDate ? { joinDate: v.joinDate } : {}),
  };
}

/** People already on record with the same phone or email. */
export async function findDuplicates(tx: Tx, v: { phone?: string | null; email?: string | null }, exceptId?: string) {
  const phone = v.phone ? normalizeNgPhone(v.phone) : null;
  const conds: SQL[] = [];
  if (phone) conds.push(eq(members.phoneHash, blindIndex(phone)!));
  if (v.email) conds.push(eq(members.emailHash, blindIndex(v.email.toLowerCase())!));
  if (!conds.length) return [];
  const rows = await tx
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, memberNo: members.memberNo })
    .from(members)
    .where(and(isNull(members.deletedAt), or(...conds)))
    .limit(3);
  return rows.filter((r) => r.id !== exceptId);
}

const CONSENT_KEYS = [
  ["consentMessaging", "messaging"],
  ["consentHealth", "health"],
  ["consentPhoto", "photo"],
] as const;

async function recordConsents(
  tx: Tx,
  ctx: Actor,
  memberId: string,
  before: Partial<Record<(typeof CONSENT_KEYS)[number][0], boolean>>,
  after: Record<(typeof CONSENT_KEYS)[number][0], boolean>,
  method: string,
) {
  const rows = CONSENT_KEYS.filter(([k]) => (before[k] ?? false) !== after[k]).map(([k, purpose]) => ({
    orgId: ctx.org.id,
    memberId,
    purpose,
    granted: after[k],
    method,
    capturedBy: ctx.user.id,
  }));
  if (rows.length) await tx.insert(consents).values(rows);
}

export async function createMember(
  tx: Tx,
  ctx: Actor,
  input: MemberInput,
  opts: { allowDuplicate?: boolean; method?: string; quiet?: boolean } = {},
) {
  assertCan(ctx, "members.write", "add members");
  const v = memberSchema.parse(input);
  assertBranch(ctx, v.branchId);
  if (!opts.allowDuplicate) {
    const dup = await findDuplicates(tx, v);
    if (dup.length)
      throw new AppError(
        `${dup[0]!.firstName} ${dup[0]!.lastName} (${dup[0]!.memberNo}) already has this phone number or email.`,
        { phone: "Already on record.", _duplicate: dup[0]!.id },
      );
  }
  const memberNo = await nextMemberNo(tx, ctx.org.id);
  const [m] = await tx
    .insert(members)
    .values({ ...toColumns(v), orgId: ctx.org.id, memberNo, createdBy: ctx.user.id })
    .returning({ id: members.id });
  await recordConsents(tx, ctx, m!.id, {}, v, opts.method ?? "staff form");
  if (!opts.quiet)
    await audit(tx, ctx, {
      action: "member.created",
      summary: `Added ${v.firstName} ${v.lastName} (${memberNo})`,
      entityType: "member",
      entityId: m!.id,
    });
  return { id: m!.id, memberNo };
}

const AUDITED = [
  "branchId",
  "title",
  "firstName",
  "middleName",
  "lastName",
  "gender",
  "dobDay",
  "dobMonth",
  "dobYear",
  "maritalStatus",
  "anniversary",
  "area",
  "occupation",
  "employer",
  "stage",
  "status",
  "joinDate",
  "baptism",
  "foundationSchoolAt",
  "consentMessaging",
  "consentHealth",
  "consentPhoto",
  "dnd",
] as const;
const LABELS: Record<string, string> = {
  phoneEnc: "phone",
  emailEnc: "email",
  addressEnc: "address",
  bloodGroupEnc: "blood group",
  genotypeEnc: "genotype",
};

export async function updateMember(tx: Tx, ctx: Actor, id: string, input: MemberInput) {
  assertCan(ctx, "members.write", "edit members");
  const v = memberSchema.parse(input);
  const [before] = await tx
    .select()
    .from(members)
    .where(and(eq(members.id, id), isNull(members.deletedAt)));
  if (!before) throw notFound("That member");
  assertBranch(ctx, before.branchId);
  assertBranch(ctx, v.branchId);
  const sensitive = ctx.can("members.read_sensitive");
  const cols = toColumns(v);
  // People who can't see sensitive fields can't overwrite them either
  if (!sensitive) {
    cols.emailEnc = before.emailEnc;
    cols.emailHash = before.emailHash;
    cols.addressEnc = before.addressEnc;
    cols.bloodGroupEnc = before.bloodGroupEnc;
    cols.genotypeEnc = before.genotypeEnc;
    cols.consentHealth = before.consentHealth;
  }
  const dup = await findDuplicates(tx, { phone: v.phone, email: sensitive ? v.email : null }, id);
  if (dup.length)
    throw new AppError(
      `${dup[0]!.firstName} ${dup[0]!.lastName} (${dup[0]!.memberNo}) already has this phone number or email.`,
      { phone: "Already on record." },
    );
  const d = diff(
    Object.fromEntries(AUDITED.map((k) => [k, before[k]])),
    Object.fromEntries(AUDITED.map((k) => [k, cols[k as keyof typeof cols] ?? before[k]])),
  );
  const changedSecret = Object.keys(LABELS).filter(
    (k) =>
      decrypt(before[k as keyof typeof before] as string | null) !==
      decrypt(cols[k as keyof typeof cols] as string | null),
  );
  if (!d.changed.length && !changedSecret.length) return;
  await tx.update(members).set(cols).where(eq(members.id, id));
  await recordConsents(tx, ctx, id, before, cols, "staff form");
  const what = [...d.changed, ...changedSecret.map((k) => LABELS[k]!)];
  await audit(tx, ctx, {
    action: "member.updated",
    summary: `Updated ${v.firstName} ${v.lastName}: ${what.join(", ")}`,
    entityType: "member",
    entityId: id,
    // encrypted values are never copied into the audit log, only the names of fields that changed
    before: d.before,
    after: d.after,
  });
}

/**
 * Removes a member. Records are soft-deleted and their contact details erased,
 * which satisfies an NDPA deletion request while keeping giving and attendance totals intact.
 */
export async function removeMember(tx: Tx, ctx: Actor, id: string, reason: string) {
  assertCan(ctx, "members.write", "remove members");
  const [m] = await tx
    .select()
    .from(members)
    .where(and(eq(members.id, id), isNull(members.deletedAt)));
  if (!m) throw notFound("That member");
  assertBranch(ctx, m.branchId);
  await tx
    .update(members)
    .set({
      deletedAt: new Date(),
      phoneEnc: null,
      phoneHash: null,
      phoneLast4: null,
      emailEnc: null,
      emailHash: null,
      addressEnc: null,
      bloodGroupEnc: null,
      genotypeEnc: null,
      householdId: null,
      householdRole: null,
    })
    .where(eq(members.id, id));
  await tx.delete(groupMembers).where(eq(groupMembers.memberId, id));
  await tx.delete(memberTags).where(eq(memberTags.memberId, id));
  await audit(tx, ctx, {
    action: "member.removed",
    summary: `Removed ${m.firstName} ${m.lastName} (${m.memberNo}). Reason: ${reason}`,
    entityType: "member",
    entityId: id,
  });
}

/** Bulk changes from the member list. */
export async function bulkUpdate(
  tx: Tx,
  ctx: Actor,
  ids: string[],
  change: {
    stage?: (typeof STAGES)[number];
    status?: (typeof MEMBER_STATUS)[number];
    addTag?: string;
    groupId?: string;
  },
) {
  assertCan(ctx, "members.write", "edit members");
  if (!ids.length) return 0;
  const rows = await tx
    .select({ id: members.id, branchId: members.branchId })
    .from(members)
    .where(and(inArray(members.id, ids), isNull(members.deletedAt)));
  rows.forEach((r) => assertBranch(ctx, r.branchId));
  const found = rows.map((r) => r.id);
  if (!found.length) return 0;
  const parts: string[] = [];
  if (change.stage || change.status) {
    await tx
      .update(members)
      .set({ ...(change.stage ? { stage: change.stage } : {}), ...(change.status ? { status: change.status } : {}) })
      .where(inArray(members.id, found));
    if (change.stage) parts.push(`stage → ${change.stage}`);
    if (change.status) parts.push(`status → ${change.status}`);
  }
  if (change.addTag) {
    const tagId = await ensureTag(tx, ctx, change.addTag);
    await tx
      .insert(memberTags)
      .values(found.map((memberId) => ({ orgId: ctx.org.id, memberId, tagId })))
      .onConflictDoNothing();
    parts.push(`tagged “${change.addTag}”`);
  }
  if (change.groupId) {
    const [g] = await tx.select().from(groups).where(eq(groups.id, change.groupId));
    if (!g) throw notFound("That group");
    await tx
      .insert(groupMembers)
      .values(found.map((memberId) => ({ orgId: ctx.org.id, memberId, groupId: g.id })))
      .onConflictDoNothing();
    parts.push(`added to ${g.name}`);
  }
  await audit(tx, ctx, {
    action: "member.bulk_updated",
    summary: `Bulk update of ${found.length} member${found.length === 1 ? "" : "s"}: ${parts.join(", ")}`,
    entityType: "member",
    after: { ids: found, ...change },
  });
  return found.length;
}

/* ---------- tags ---------- */

const TAG_COLORS = ["blue", "green", "amber", "pink", "purple", "teal"] as const;

export async function listTags(tx: Tx) {
  return tx
    .select({ id: tags.id, name: tags.name, color: tags.color, n: count(memberTags.memberId) })
    .from(tags)
    .leftJoin(memberTags, eq(memberTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
}

async function ensureTag(tx: Tx, ctx: Actor, name: string) {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new AppError("Enter a tag name.");
  const [existing] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(sql`lower(${tags.name}) = lower(${clean})`);
  if (existing) return existing.id;
  const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(tags);
  const [t] = await tx
    .insert(tags)
    .values({ orgId: ctx.org.id, name: clean, color: TAG_COLORS[Number(n) % TAG_COLORS.length] })
    .returning({ id: tags.id });
  return t!.id;
}

export async function setMemberTags(tx: Tx, ctx: Actor, memberId: string, names: string[]) {
  assertCan(ctx, "members.write", "tag members");
  const [m] = await tx.select().from(members).where(eq(members.id, memberId));
  if (!m) throw notFound("That member");
  assertBranch(ctx, m.branchId);
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const ids = new Set<string>();
  for (const n of unique) ids.add(await ensureTag(tx, ctx, n));
  await tx.delete(memberTags).where(eq(memberTags.memberId, memberId));
  if (ids.size) await tx.insert(memberTags).values([...ids].map((tagId) => ({ orgId: ctx.org.id, memberId, tagId })));
  await audit(tx, ctx, {
    action: "member.tags",
    summary: unique.length
      ? `Tags for ${m.firstName} ${m.lastName}: ${unique.join(", ")}`
      : `Cleared tags for ${m.firstName} ${m.lastName}`,
    entityType: "member",
    entityId: memberId,
  });
}

/* ---------- households ---------- */

export async function linkHousehold(
  tx: Tx,
  ctx: Actor,
  input: {
    memberId: string;
    otherId: string;
    memberRole: "head" | "spouse" | "child" | "relative";
    otherRole: "head" | "spouse" | "child" | "relative";
  },
) {
  assertCan(ctx, "members.write", "manage families");
  if (input.memberId === input.otherId) throw new AppError("Choose a different person.");
  const rows = await tx
    .select()
    .from(members)
    .where(and(inArray(members.id, [input.memberId, input.otherId]), isNull(members.deletedAt)));
  const a = rows.find((r) => r.id === input.memberId);
  const b = rows.find((r) => r.id === input.otherId);
  if (!a || !b) throw notFound("That member");
  assertBranch(ctx, a.branchId);
  if (a.householdId && b.householdId && a.householdId !== b.householdId)
    throw new AppError(`${b.firstName} already belongs to another family. Remove them from it first.`);
  let hh = a.householdId ?? b.householdId;
  if (!hh) {
    const head = input.memberRole === "head" ? a : input.otherRole === "head" ? b : a;
    const [h] = await tx
      .insert(households)
      .values({ orgId: ctx.org.id, name: `The ${head.lastName} family` })
      .returning({ id: households.id });
    hh = h!.id;
  }
  await tx.update(members).set({ householdId: hh, householdRole: input.memberRole }).where(eq(members.id, a.id));
  await tx.update(members).set({ householdId: hh, householdRole: input.otherRole }).where(eq(members.id, b.id));
  await audit(tx, ctx, {
    action: "household.linked",
    summary: `Linked ${a.firstName} ${a.lastName} and ${b.firstName} ${b.lastName} as one family`,
    entityType: "member",
    entityId: a.id,
  });
}

export async function leaveHousehold(tx: Tx, ctx: Actor, memberId: string) {
  assertCan(ctx, "members.write", "manage families");
  const [m] = await tx.select().from(members).where(eq(members.id, memberId));
  if (!m?.householdId) return;
  assertBranch(ctx, m.branchId);
  await tx.update(members).set({ householdId: null, householdRole: null }).where(eq(members.id, memberId));
  await audit(tx, ctx, {
    action: "household.left",
    summary: `Removed ${m.firstName} ${m.lastName} from their family`,
    entityType: "member",
    entityId: memberId,
  });
}

/* ---------- export ---------- */

export async function exportRows(tx: Tx, ctx: Actor, f: MemberFilters) {
  assertCan(ctx, "members.export", "export members");
  const sensitive = ctx.can("members.read_sensitive");
  const rows = await tx
    .select({ m: members, branchName: branches.name })
    .from(members)
    .innerJoin(branches, eq(branches.id, members.branchId))
    .where(filterSql(ctx, f))
    .orderBy(asc(members.lastName), asc(members.firstName))
    .limit(50000);
  await audit(tx, ctx, {
    action: "member.exported",
    summary: `Exported ${rows.length} member${rows.length === 1 ? "" : "s"}${sensitive ? " including contact details" : ""}`,
    entityType: "member",
    after: { filters: f, count: rows.length },
  });
  const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return rows.map(({ m, branchName }) => ({
    "Member no": m.memberNo,
    Title: m.title ?? "",
    "First name": m.firstName,
    "Middle name": m.middleName ?? "",
    Surname: m.lastName,
    Gender: m.gender,
    Birthday: m.dobDay && m.dobMonth ? `${m.dobDay} ${MONTHS[m.dobMonth]}${m.dobYear ? " " + m.dobYear : ""}` : "",
    Phone: localPhone(decrypt(m.phoneEnc)),
    ...(sensitive ? { Email: decrypt(m.emailEnc) ?? "", Address: decrypt(m.addressEnc) ?? "" } : {}),
    Area: m.area ?? "",
    Branch: branchName,
    Stage: m.stage,
    Status: m.status,
    "Marital status": m.maritalStatus ?? "",
    Occupation: m.occupation ?? "",
    "Joined on": m.joinDate,
    "SMS consent": m.consentMessaging && !m.dnd ? "yes" : "no",
  }));
}

/* ---------- dashboard ---------- */

export async function memberStats(tx: Tx, ctx: Actor) {
  const scope = and(isNull(members.deletedAt), branchScope(ctx, members.branchId));
  const [totals] = await tx
    .select({
      total: sql<number>`count(*) filter (where ${members.status} = 'active')`,
      members: sql<number>`count(*) filter (where ${members.status} = 'active' and ${members.stage} in ('member','regular'))`,
      firstTimers: sql<number>`count(*) filter (where ${members.stage} in ('first_timer','second_timer') and ${members.createdAt} > now() - interval '30 days')`,
      newThisMonth: sql<number>`count(*) filter (where date_trunc('month', ${members.joinDate}) = date_trunc('month', (now() at time zone 'Africa/Lagos')::date))`,
      newLastMonth: sql<number>`count(*) filter (where date_trunc('month', ${members.joinDate}) = date_trunc('month', (now() at time zone 'Africa/Lagos')::date - interval '1 month'))`,
      male: sql<number>`count(*) filter (where ${members.status} = 'active' and ${members.gender} = 'male')`,
      female: sql<number>`count(*) filter (where ${members.status} = 'active' and ${members.gender} = 'female')`,
    })
    .from(members)
    .where(scope);
  const growth = await tx
    .select({
      month: sql<string>`to_char(date_trunc('month', ${members.joinDate}), 'YYYY-MM')`,
      n: count(),
    })
    .from(members)
    .where(and(scope, sql`${members.joinDate} >= date_trunc('month', current_date) - interval '11 months'`))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const stages = await tx
    .select({ stage: members.stage, n: count() })
    .from(members)
    .where(and(scope, eq(members.status, "active")))
    .groupBy(members.stage);
  const birthdays = await tx
    .select({
      id: members.id,
      title: members.title,
      firstName: members.firstName,
      lastName: members.lastName,
      dobDay: members.dobDay,
      dobMonth: members.dobMonth,
    })
    .from(members)
    .where(and(scope, eq(members.status, "active"), birthdaySql("week")))
    .orderBy(asc(members.dobMonth), asc(members.dobDay))
    .limit(8);
  // fill in empty months so the chart has a continuous axis
  const months: { month: string; n: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, n: Number(growth.find((g) => g.month === key)?.n ?? 0) });
  }
  const t = totals!;
  return {
    total: Number(t.total),
    members: Number(t.members),
    firstTimers: Number(t.firstTimers),
    newThisMonth: Number(t.newThisMonth),
    newLastMonth: Number(t.newLastMonth),
    male: Number(t.male),
    female: Number(t.female),
    growth: months,
    stages: Object.fromEntries(stages.map((s) => [s.stage, Number(s.n)])) as Record<string, number>,
    birthdays,
  };
}
