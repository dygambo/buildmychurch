import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import { branches, careCases, careEntries, CARE_KINDS, memberships, members, organisations, prayerRequests, PRAYER_CATEGORIES, publicLinks, roles, users } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { formatDate, naira, todayISO } from "@/lib/format";
import { formatPhone, normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";

export const PRAYER_LABEL: Record<(typeof PRAYER_CATEGORIES)[number], string> = {
  healing: "Healing",
  family: "Family and marriage",
  finances: "Finances",
  career: "Job and career",
  salvation: "Salvation",
  guidance: "Direction",
  deliverance: "Deliverance",
  thanksgiving: "Thanksgiving",
  other: "Other",
};

export const CARE_LABEL: Record<(typeof CARE_KINDS)[number], string> = {
  hospital: "In hospital",
  bereavement: "Bereavement",
  counselling: "Counselling",
  welfare: "Welfare need",
  new_baby: "New baby",
  wedding: "Wedding",
  visitation: "Home visit",
  other: "Other",
};

export const WELFARE_LABEL = {
  cash: "Cash",
  transfer: "Bank transfer",
  foodstuff: "Foodstuff",
  hospital_bill: "Hospital bill",
  school_fees: "School fees",
  rent: "Rent",
  other: "Other",
} as const;

/** Confidential prayer and care records are for people who may see health and personal details (pastors). */
export const seesConfidential = (ctx: Pick<Actor, "can">) => ctx.can("members.read_sensitive");

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
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
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
  .or(z.literal(""))
  .transform((v) => v || null);

/** People who can be given care work: anyone whose role includes care.manage. */
export async function careTeam(tx: Tx, orgId: string) {
  return tx
    .select({ id: users.id, name: users.name, email: users.email, sensitive: sql<boolean>`'members.read_sensitive' = any(${roles.permissions})` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active"), sql`'care.manage' = any(${roles.permissions})`))
    .orderBy(asc(users.name));
}

async function assigneeName(tx: Tx, orgId: string, userId: string | null) {
  if (!userId) return null;
  const team = await careTeam(tx, orgId);
  const u = team.find((t) => t.id === userId);
  if (!u) throw new AppError("Choose someone on the care team (their role needs Prayer and care).");
  return u.name;
}

/* ================= prayer requests ================= */

export const prayerSchema = z.object({
  memberId: optUuid,
  name: optText(120),
  phone: optText(30),
  email: optEmail,
  body: z.string().trim().min(5, "Write the prayer request.").max(3000),
  category: z.enum(PRAYER_CATEGORIES).default("other"),
  confidential: z.boolean().default(false),
  wantsContact: z.boolean().default(false),
  branchId: optUuid,
});

async function insertPrayer(
  tx: Tx,
  orgId: string,
  input: z.output<typeof prayerSchema>,
  source: "online" | "visitor_card" | "staff" | "portal",
  by: string,
) {
  const phone = normalizeNgPhone(input.phone);
  if (input.phone && !phone) throw new AppError("Check the phone number.", { phone: "Enter a Nigerian number, e.g. 0803 123 4567." });
  let memberId = input.memberId;
  let name = input.name;
  let branchId = input.branchId;
  if (memberId) {
    const [m] = await tx.select({ first: members.firstName, last: members.lastName, branchId: members.branchId }).from(members).where(eq(members.id, memberId));
    if (!m) throw notFound("That member");
    name = name ?? `${m.first} ${m.last}`;
    branchId = branchId ?? m.branchId;
  } else if (phone || input.email) {
    // match a member quietly so the pastor sees who it is
    const [m] = await tx
      .select({ id: members.id, branchId: members.branchId })
      .from(members)
      .where(and(isNull(members.deletedAt), phone ? eq(members.phoneHash, blindIndex(phone)!) : eq(members.emailHash, blindIndex(input.email)!)))
      .limit(1);
    if (m) {
      memberId = m.id;
      branchId = branchId ?? m.branchId;
    }
  }
  const [r] = await tx
    .insert(prayerRequests)
    .values({
      orgId,
      branchId,
      memberId,
      name,
      phoneEnc: encrypt(phone),
      emailEnc: encrypt(input.email),
      bodyEnc: encrypt(input.body)!,
      category: input.category,
      confidential: input.confidential,
      wantsContact: input.wantsContact,
      source,
      createdByName: by,
    })
    .returning({ id: prayerRequests.id });
  return r!.id;
}

/** Tell the care team a request came in. Confidential text never goes into an email. */
export async function notifyPrayerTeam(tx: Tx, orgId: string, id: string, input: z.output<typeof prayerSchema>, name: string | null) {
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  const team = await careTeam(tx, orgId);
  const url = `${env().APP_URL}/care?open=${id}`;
  for (const u of team) {
    if (input.confidential && !u.sensitive) continue;
    await enqueue(
      tx,
      "email.send",
      {
        to: u.email,
        subject: `${input.confidential ? "Confidential prayer request" : `Prayer request: ${PRAYER_LABEL[input.category]}`}${name ? ` from ${name}` : ""}`,
        html: emailLayout({
          church: o!.name,
          heading: "A new prayer request",
          bodyHtml:
            (input.confidential ? p("This request is confidential. Open it in Build My Church to read it.") : p(`<em>${esc(input.body)}</em>`)) +
            (input.wantsContact ? p("They would like someone to contact them.") : ""),
          button: { label: "Open the prayer list", url },
        }),
      },
      { orgId, dedupeKey: `prayer:${id}:${u.id}` },
    );
  }
}

export async function addPrayer(tx: Tx, ctx: Actor, input: z.output<typeof prayerSchema>) {
  assertCan(ctx, "care.manage", "add prayer requests");
  if (input.confidential && !seesConfidential(ctx)) throw new AppError("Only pastors can file confidential requests. Untick Confidential, or ask a pastor.");
  if (!input.memberId && !input.name) throw new AppError("Choose a member or type the person's name.", { name: "Who is it for?" });
  const id = await insertPrayer(tx, ctx.org.id, input, "staff", ctx.user.name);
  await audit(tx, ctx, { action: "prayer.added", summary: `Added a prayer request${input.confidential ? " (confidential)" : ""} for ${input.name ?? "a member"}`, entityType: "prayer", entityId: id });
  return id;
}

/** The church's public prayer page link (one per church). */
export async function prayerLink(tx: Tx, ctx: Actor) {
  assertCan(ctx, "care.manage", "share the prayer page");
  const [l] = await tx
    .select()
    .from(publicLinks)
    .where(and(eq(publicLinks.orgId, ctx.org.id), eq(publicLinks.kind, "prayer"), isNull(publicLinks.revokedAt)));
  if (l) return `${env().APP_URL}/p/${l.token}`;
  const token = randomToken(9);
  await tx.insert(publicLinks).values({ token, orgId: ctx.org.id, kind: "prayer" });
  return `${env().APP_URL}/p/${token}`;
}

export async function publicPrayerPage(token: string) {
  const [l] = await db.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!l || l.kind !== "prayer" || l.revokedAt) return null;
  const [o] = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(eq(organisations.id, l.orgId));
  return o ?? null;
}

export const publicPrayerSchema = prayerSchema.omit({ memberId: true, branchId: true }).extend({
  name: optText(120),
});

/** Someone sends a request from the public prayer page. They can stay anonymous. */
export async function submitPublicPrayer(token: string, input: z.output<typeof publicPrayerSchema>) {
  const org = await publicPrayerPage(token);
  if (!org) throw new AppError("This prayer page link isn't valid. Ask the church for the right one.");
  if (input.wantsContact && !input.phone && !input.email) throw new AppError("Add a phone number or email so someone can reach you.", { phone: "How can we reach you?" });
  return withOrg(org.id, async (tx) => {
    const full = { ...input, memberId: null, branchId: null };
    const id = await insertPrayer(tx, org.id, full, "online", "Prayer page");
    await audit(tx, { system: "Prayer page", orgId: org.id }, { action: "prayer.received", summary: "Received a prayer request from the prayer page", entityType: "prayer", entityId: id });
    await notifyPrayerTeam(tx, org.id, id, full, input.name);
    if (input.email)
      await enqueue(
        tx,
        "email.send",
        {
          to: input.email,
          subject: `We're praying with you`,
          html: emailLayout({
            church: org.name,
            heading: `${input.name ? `${esc(input.name.split(" ")[0]!)}, w` : "W"}e received your prayer request`,
            bodyHtml:
              p(`Our prayer team at ${esc(org.name)} will pray with you this week.`) +
              (input.wantsContact ? p("Someone from the pastoral team will contact you soon.") : "") +
              p("“The prayer of a righteous person is powerful and effective.” James 5:16"),
          }),
        },
        { orgId: org.id, dedupeKey: `prayer-ack:${id}` },
      );
    return { church: org.name };
  });
}

/** From the visitor card. */
export async function prayerFromVisitorCard(tx: Tx, orgId: string, input: { memberId: string; name: string; body: string; wantsContact: boolean }) {
  await insertPrayer(
    tx,
    orgId,
    { memberId: input.memberId, name: input.name, phone: null, email: null, body: input.body, category: "other", confidential: false, wantsContact: input.wantsContact, branchId: null },
    "visitor_card",
    "Visitor card",
  );
}

export async function listPrayer(tx: Tx, ctx: Actor, f: { status?: string; category?: string; q?: string; mine?: boolean } = {}) {
  assertCan(ctx, "care.manage", "see prayer requests");
  const status = f.status === "all" ? undefined : f.status && ["new", "praying", "answered", "closed"].includes(f.status) ? f.status : "open";
  const rows = await tx
    .select({ r: prayerRequests, branchName: branches.name })
    .from(prayerRequests)
    .leftJoin(branches, eq(branches.id, prayerRequests.branchId))
    .where(
      and(
        isNull(prayerRequests.deletedAt),
        seesConfidential(ctx) ? undefined : eq(prayerRequests.confidential, false),
        ctx.branchIds.length ? sql`(${prayerRequests.branchId} is null or ${inArray(prayerRequests.branchId, ctx.branchIds)})` : undefined,
        status === "open"
          ? inArray(prayerRequests.status, ["new", "praying"])
          : status
            ? eq(prayerRequests.status, status as "new" | "praying" | "answered" | "closed")
            : undefined,
        f.category && (PRAYER_CATEGORIES as readonly string[]).includes(f.category) ? eq(prayerRequests.category, f.category as "other") : undefined,
        f.mine ? eq(prayerRequests.assignedTo, ctx.user.id) : undefined,
      ),
    )
    .orderBy(desc(prayerRequests.createdAt))
    .limit(500);
  const list = rows.map(({ r, branchName }) => ({
    id: r.id,
    name: r.name,
    memberId: r.memberId,
    phone: decrypt(r.phoneEnc),
    email: decrypt(r.emailEnc),
    body: decrypt(r.bodyEnc) ?? "",
    category: r.category,
    confidential: r.confidential,
    wantsContact: r.wantsContact,
    source: r.source,
    status: r.status,
    assignedTo: r.assignedTo,
    assignedName: r.assignedName,
    prayedCount: r.prayedCount,
    lastPrayedAt: r.lastPrayedAt,
    testimony: decrypt(r.testimonyEnc),
    branchName,
    createdAt: r.createdAt,
  }));
  const q = f.q?.trim().toLowerCase();
  return q ? list.filter((r) => `${r.name ?? ""} ${r.body} ${r.phone ?? ""}`.toLowerCase().includes(q)) : list;
}
export type PrayerRow = Awaited<ReturnType<typeof listPrayer>>[number];

async function loadPrayer(tx: Tx, ctx: Actor, id: string) {
  const [r] = await tx.select().from(prayerRequests).where(and(eq(prayerRequests.id, id), isNull(prayerRequests.deletedAt))).for("update");
  if (!r || (r.confidential && !seesConfidential(ctx))) throw notFound("That prayer request");
  if (r.branchId) assertBranch(ctx, r.branchId);
  return r;
}

export const prayerUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "praying", "answered", "closed"]).optional(),
  assignedTo: optUuid.optional(),
  testimony: optText(3000).optional(),
  category: z.enum(PRAYER_CATEGORIES).optional(),
});

export async function updatePrayer(tx: Tx, ctx: Actor, input: z.output<typeof prayerUpdateSchema>) {
  assertCan(ctx, "care.manage", "update prayer requests");
  const r = await loadPrayer(tx, ctx, input.id);
  const set: Partial<typeof prayerRequests.$inferInsert> = {};
  const said: string[] = [];
  if (input.status && input.status !== r.status) {
    set.status = input.status;
    set.closedAt = input.status === "answered" || input.status === "closed" ? new Date() : null;
    said.push(input.status === "answered" ? "marked it answered" : input.status === "closed" ? "closed it" : input.status === "praying" ? "started praying" : "reopened it");
  }
  if (input.assignedTo !== undefined && input.assignedTo !== r.assignedTo) {
    set.assignedTo = input.assignedTo;
    set.assignedName = await assigneeName(tx, ctx.org.id, input.assignedTo);
    said.push(input.assignedTo ? `gave it to ${set.assignedName}` : "unassigned it");
    if (r.status === "new" && !input.status) set.status = "praying";
  }
  if (input.testimony !== undefined) {
    set.testimonyEnc = encrypt(input.testimony);
    said.push("recorded the testimony");
  }
  if (input.category && input.category !== r.category) {
    set.category = input.category;
    said.push(`filed it under ${PRAYER_LABEL[input.category]}`);
  }
  if (!said.length) return;
  await tx.update(prayerRequests).set(set).where(eq(prayerRequests.id, r.id));
  await audit(tx, ctx, { action: "prayer.updated", summary: `Prayer request for ${r.name ?? "someone"}: ${said.join(", ")}`, entityType: "prayer", entityId: r.id });
}

/** "I prayed": a tally the team can see, so requests don't go unprayed. */
export async function markPrayed(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "care.manage", "update prayer requests");
  const r = await loadPrayer(tx, ctx, id);
  await tx
    .update(prayerRequests)
    .set({ prayedCount: r.prayedCount + 1, lastPrayedAt: new Date(), status: r.status === "new" ? "praying" : r.status })
    .where(eq(prayerRequests.id, id));
  await audit(tx, ctx, { action: "prayer.prayed", summary: `Prayed for ${r.name ?? "a request"}`, entityType: "prayer", entityId: id });
  return r.prayedCount + 1;
}

export async function deletePrayer(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "care.manage", "remove prayer requests");
  const r = await loadPrayer(tx, ctx, id);
  await tx.update(prayerRequests).set({ deletedAt: new Date() }).where(eq(prayerRequests.id, id));
  await audit(tx, ctx, { action: "prayer.deleted", summary: `Removed a prayer request from ${r.name ?? "someone"}`, entityType: "prayer", entityId: id });
}

/* ================= pastoral care cases ================= */

export const caseSchema = z.object({
  id: z.string().uuid().optional(),
  memberId: z.string().uuid("Choose the member."),
  kind: z.enum(CARE_KINDS),
  title: z.string().trim().min(3, "Say what's happening, e.g. Admitted at LUTH after an accident.").max(140),
  summary: optText(5000),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  confidential: z.boolean().default(false),
  assignedTo: optUuid,
  nextActionOn: optDate,
  nextAction: optText(200),
  prayerRequestId: optUuid,
});

async function loadCase(tx: Tx, ctx: Actor, id: string) {
  const [c] = await tx.select().from(careCases).where(eq(careCases.id, id)).for("update");
  if (!c || (c.confidential && !seesConfidential(ctx))) throw notFound("That care record");
  assertBranch(ctx, c.branchId);
  return c;
}

export async function saveCase(tx: Tx, ctx: Actor, input: z.output<typeof caseSchema>) {
  assertCan(ctx, "care.manage", "manage pastoral care");
  const confidential = input.confidential || input.kind === "counselling";
  if (confidential && !seesConfidential(ctx)) throw new AppError("Counselling and confidential records are for pastors. Choose another kind, or ask a pastor.");
  const [m] = await tx.select({ first: members.firstName, last: members.lastName, branchId: members.branchId }).from(members).where(and(eq(members.id, input.memberId), isNull(members.deletedAt)));
  if (!m) throw notFound("That member");
  assertBranch(ctx, m.branchId);
  const values = {
    memberId: input.memberId,
    branchId: m.branchId,
    kind: input.kind,
    title: input.title,
    summaryEnc: encrypt(input.summary),
    priority: input.priority,
    confidential,
    assignedTo: input.assignedTo,
    assignedName: await assigneeName(tx, ctx.org.id, input.assignedTo),
    nextActionOn: input.nextActionOn,
    nextAction: input.nextAction,
  };
  const who = `${m.first} ${m.last}`;
  if (input.id) {
    const c = await loadCase(tx, ctx, input.id);
    await tx.update(careCases).set(values).where(eq(careCases.id, c.id));
    await audit(tx, ctx, { action: "care.updated", summary: `Updated the care record for ${who}`, entityType: "care", entityId: c.id });
    return c.id;
  }
  const [c] = await tx
    .insert(careCases)
    .values({ ...values, orgId: ctx.org.id, prayerRequestId: input.prayerRequestId, openedBy: ctx.user.id, openedByName: ctx.user.name })
    .returning({ id: careCases.id });
  if (input.prayerRequestId) await tx.update(prayerRequests).set({ status: "praying" }).where(and(eq(prayerRequests.id, input.prayerRequestId), eq(prayerRequests.status, "new")));
  await audit(tx, ctx, { action: "care.opened", summary: `Opened a care record for ${who}: ${CARE_LABEL[input.kind]}`, entityType: "care", entityId: c!.id });
  if (input.assignedTo && input.assignedTo !== ctx.user.id) {
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, input.assignedTo));
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ctx.org.id));
    if (u)
      await enqueue(
        tx,
        "email.send",
        {
          to: u.email,
          subject: `${input.priority === "urgent" ? "Urgent: " : ""}Please look after ${who}`,
          html: emailLayout({
            church: o!.name,
            heading: `${esc(ctx.user.name)} asked you to look after ${esc(who)}`,
            bodyHtml: p(`${CARE_LABEL[input.kind]}${confidential ? "" : `: ${esc(input.title)}`}.`) + (input.nextAction ? p(`Next: ${esc(input.nextAction)}${input.nextActionOn ? ` by ${formatDate(input.nextActionOn)}` : ""}.`) : ""),
            button: { label: "Open the record", url: `${env().APP_URL}/care/cases/${c!.id}` },
          }),
        },
        { orgId: ctx.org.id, dedupeKey: `care-assign:${c!.id}:${input.assignedTo}` },
      );
  }
  return c!.id;
}

export const entrySchema = z
  .object({
    caseId: z.string().uuid(),
    kind: z.enum(["note", "visit", "call", "welfare"]),
    body: optText(5000),
    happenedOn: isoDate,
    amount: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => (v === "" || v === null || v === undefined ? null : Math.round(Number(String(v).replace(/[₦,\s]/g, "")) * 100))),
    welfareKind: z.enum(["cash", "transfer", "foodstuff", "hospital_bill", "school_fees", "rent", "other"]).optional().nullable(),
    nextActionOn: optDate.optional(),
    nextAction: optText(200).optional(),
  })
  .superRefine((v, c) => {
    if (v.happenedOn > todayISO()) c.addIssue({ code: "custom", path: ["happenedOn"], message: "Record what has happened. Use Next step for plans." });
    if (v.kind === "welfare") {
      if (!v.welfareKind) c.addIssue({ code: "custom", path: ["welfareKind"], message: "Choose what was given." });
      if (v.amount !== null && (!Number.isFinite(v.amount) || v.amount <= 0)) c.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount or value in naira." });
      if (v.amount === null && v.welfareKind !== "foodstuff" && v.welfareKind !== "other") c.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount given." });
    } else if (!v.body) c.addIssue({ code: "custom", path: ["body"], message: "Write what happened." });
  });

export async function addEntry(tx: Tx, ctx: Actor, input: z.output<typeof entrySchema>) {
  assertCan(ctx, "care.manage", "add to care records");
  const c = await loadCase(tx, ctx, input.caseId);
  if (c.status === "closed") throw new AppError("This record is closed. Reopen it to add to it.");
  const [e] = await tx
    .insert(careEntries)
    .values({
      orgId: ctx.org.id,
      caseId: c.id,
      kind: input.kind,
      bodyEnc: encrypt(input.body),
      happenedOn: input.happenedOn,
      amountKobo: input.kind === "welfare" ? input.amount : null,
      welfareKind: input.kind === "welfare" ? input.welfareKind : null,
      authorId: ctx.user.id,
      authorName: ctx.user.name,
    })
    .returning({ id: careEntries.id });
  if (input.nextActionOn !== undefined || input.nextAction !== undefined)
    await tx
      .update(careCases)
      .set({ nextActionOn: input.nextActionOn ?? null, nextAction: input.nextAction ?? null })
      .where(eq(careCases.id, c.id));
  else await tx.update(careCases).set({ updatedAt: new Date() }).where(eq(careCases.id, c.id));
  const what =
    input.kind === "welfare"
      ? `Gave welfare (${WELFARE_LABEL[input.welfareKind!]}${input.amount ? `, ${naira(input.amount)}` : ""})`
      : input.kind === "visit"
        ? "Recorded a visit"
        : input.kind === "call"
          ? "Recorded a call"
          : "Added a note";
  await audit(tx, ctx, { action: `care.${input.kind}`, summary: `${what} on a care record`, entityType: "care", entityId: c.id });
  return e!.id;
}

export async function closeCase(tx: Tx, ctx: Actor, input: { id: string; note: string | null }) {
  assertCan(ctx, "care.manage", "close care records");
  const c = await loadCase(tx, ctx, input.id);
  if (c.status === "closed") return;
  await tx.update(careCases).set({ status: "closed", closedAt: new Date(), closedNote: input.note, nextActionOn: null, nextAction: null }).where(eq(careCases.id, c.id));
  await audit(tx, ctx, { action: "care.closed", summary: `Closed a care record: ${c.title}`, entityType: "care", entityId: c.id });
}

export async function reopenCase(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "care.manage", "reopen care records");
  const c = await loadCase(tx, ctx, id);
  await tx.update(careCases).set({ status: "open", closedAt: null }).where(eq(careCases.id, c.id));
  await audit(tx, ctx, { action: "care.reopened", summary: `Reopened a care record: ${c.title}`, entityType: "care", entityId: c.id });
}

export async function listCases(tx: Tx, ctx: Actor, f: { status?: string; kind?: string; mine?: boolean; memberId?: string } = {}) {
  assertCan(ctx, "care.manage", "see pastoral care");
  const rows = await tx
    .select({
      c: careCases,
      first: members.firstName,
      last: members.lastName,
      lastEntry: sql<string | null>`(select max(e.happened_on)::text from care_entries e where e.case_id = care_cases.id)`,
      welfare: sql<number>`coalesce((select sum(e.amount_kobo) from care_entries e where e.case_id = care_cases.id and e.kind = 'welfare'), 0)::bigint`,
      visits: sql<number>`(select count(*) from care_entries e where e.case_id = care_cases.id and e.kind in ('visit','call'))::int`,
    })
    .from(careCases)
    .innerJoin(members, eq(members.id, careCases.memberId))
    .where(
      and(
        branchScope(ctx, careCases.branchId),
        seesConfidential(ctx) ? undefined : eq(careCases.confidential, false),
        f.status === "closed" ? eq(careCases.status, "closed") : f.status === "all" ? undefined : eq(careCases.status, "open"),
        f.kind && (CARE_KINDS as readonly string[]).includes(f.kind) ? eq(careCases.kind, f.kind as "other") : undefined,
        f.mine ? eq(careCases.assignedTo, ctx.user.id) : undefined,
        f.memberId ? eq(careCases.memberId, f.memberId) : undefined,
      ),
    )
    .orderBy(
      sql`case ${careCases.priority} when 'urgent' then 0 when 'high' then 1 else 2 end`,
      sql`${careCases.nextActionOn} asc nulls last`,
      desc(careCases.updatedAt),
    )
    .limit(300);
  return rows.map((r) => ({
    id: r.c.id,
    memberId: r.c.memberId,
    memberName: `${r.first} ${r.last}`,
    kind: r.c.kind,
    title: r.c.title,
    priority: r.c.priority,
    confidential: r.c.confidential,
    status: r.c.status,
    assignedName: r.c.assignedName,
    nextActionOn: r.c.nextActionOn,
    nextAction: r.c.nextAction,
    lastEntry: r.lastEntry,
    welfareKobo: Number(r.welfare),
    contacts: r.visits,
    createdAt: r.c.createdAt,
    closedAt: r.c.closedAt,
  }));
}
export type CaseRow = Awaited<ReturnType<typeof listCases>>[number];

export async function getCase(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "care.manage", "see pastoral care");
  const [c] = await tx.select().from(careCases).where(eq(careCases.id, id));
  if (!c || (c.confidential && !seesConfidential(ctx))) throw notFound("That care record");
  assertBranch(ctx, c.branchId);
  const [m] = await tx
    .select({ id: members.id, first: members.firstName, last: members.lastName, title: members.title, phoneEnc: members.phoneEnc, addressEnc: members.addressEnc, area: members.area })
    .from(members)
    .where(eq(members.id, c.memberId));
  const entries = await tx.select().from(careEntries).where(eq(careEntries.caseId, c.id)).orderBy(desc(careEntries.happenedOn), desc(careEntries.createdAt));
  const others = (await listCases(tx, ctx, { status: "all", memberId: c.memberId })).filter((x) => x.id !== c.id);
  const sensitive = seesConfidential(ctx);
  let prayer: { body: string; createdAt: Date } | null = null;
  if (c.prayerRequestId) {
    const [pr] = await tx.select().from(prayerRequests).where(eq(prayerRequests.id, c.prayerRequestId));
    if (pr && (!pr.confidential || sensitive)) prayer = { body: decrypt(pr.bodyEnc) ?? "", createdAt: pr.createdAt };
  }
  return {
    ...c,
    summary: decrypt(c.summaryEnc),
    member: {
      id: m!.id,
      name: [m!.title, m!.first, m!.last].filter(Boolean).join(" "),
      phone: formatPhone(decrypt(m!.phoneEnc)),
      address: sensitive ? decrypt(m!.addressEnc) : null,
      area: m!.area,
    },
    entries: entries.map((e) => ({ ...e, body: decrypt(e.bodyEnc), amountKobo: e.amountKobo === null ? null : Number(e.amountKobo) })),
    welfareKobo: entries.reduce((t, e) => t + Number(e.amountKobo ?? 0), 0),
    others,
    prayer,
  };
}

/** The numbers at the top of the care page and on the dashboard. */
export async function careSummary(tx: Tx, ctx: Actor) {
  assertCan(ctx, "care.manage", "see pastoral care");
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const conf = seesConfidential(ctx) ? undefined : eq(careCases.confidential, false);
  const [cases] = await tx
    .select({
      open: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${careCases.nextActionOn} <= ${today})::int`,
      urgent: sql<number>`count(*) filter (where ${careCases.priority} = 'urgent')::int`,
    })
    .from(careCases)
    .where(and(eq(careCases.status, "open"), branchScope(ctx, careCases.branchId), conf));
  const [welfare] = await tx
    .select({ total: sql<number>`coalesce(sum(${careEntries.amountKobo}), 0)::bigint`, people: sql<number>`count(distinct ${careCases.memberId})::int` })
    .from(careEntries)
    .innerJoin(careCases, eq(careCases.id, careEntries.caseId))
    .where(and(eq(careEntries.kind, "welfare"), gte(careEntries.happenedOn, monthStart), lte(careEntries.happenedOn, today), branchScope(ctx, careCases.branchId), conf));
  const [prayer] = await tx
    .select({ fresh: sql<number>`count(*) filter (where ${prayerRequests.status} = 'new')::int`, open: sql<number>`count(*)::int` })
    .from(prayerRequests)
    .where(
      and(
        isNull(prayerRequests.deletedAt),
        inArray(prayerRequests.status, ["new", "praying"]),
        seesConfidential(ctx) ? undefined : eq(prayerRequests.confidential, false),
      ),
    );
  return {
    openCases: cases?.open ?? 0,
    dueCases: cases?.due ?? 0,
    urgentCases: cases?.urgent ?? 0,
    welfareMonthKobo: Number(welfare?.total ?? 0),
    welfarePeople: welfare?.people ?? 0,
    newPrayer: prayer?.fresh ?? 0,
    openPrayer: prayer?.open ?? 0,
  };
}

/** Welfare given in a period, for the reports page and the welfare committee. */
export async function welfareReport(tx: Tx, ctx: Actor, range: { from: string; to: string }) {
  assertCan(ctx, "care.manage", "see welfare");
  const rows = await tx
    .select({
      on: careEntries.happenedOn,
      kind: careEntries.welfareKind,
      amount: careEntries.amountKobo,
      member: sql<string>`${members.firstName} || ' ' || ${members.lastName}`,
      caseKind: careCases.kind,
      confidential: careCases.confidential,
      by: careEntries.authorName,
    })
    .from(careEntries)
    .innerJoin(careCases, eq(careCases.id, careEntries.caseId))
    .innerJoin(members, eq(members.id, careCases.memberId))
    .where(and(eq(careEntries.kind, "welfare"), gte(careEntries.happenedOn, range.from), lte(careEntries.happenedOn, range.to), branchScope(ctx, careCases.branchId)))
    .orderBy(desc(careEntries.happenedOn));
  const sensitive = seesConfidential(ctx);
  return rows.map((r) => ({ ...r, member: r.confidential && !sensitive ? "Confidential" : r.member, amount: Number(r.amount ?? 0) }));
}
