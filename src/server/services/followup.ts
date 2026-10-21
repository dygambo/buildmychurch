import { prayerFromVisitorCard } from "./care";
import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import {
  followupNotes,
  followups,
  memberships,
  members,
  publicLinks,
  roles,
  users,
  FOLLOWUP_STAGES,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan, systemActor } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, p } from "../emails/layout";
import { normalizeNgPhone } from "@/lib/phone";
import { absentees } from "./attendance";
import { createMember } from "./members";
import { assertBranch, branchScope } from "./scope";

export type FollowupStage = (typeof FOLLOWUP_STAGES)[number];
export const STAGE_TITLES: Record<FollowupStage, string> = {
  new: "New",
  contacted: "Contacted",
  visited: "Visited",
  integrated: "Integrated",
  closed: "Closed",
};

/** People who can be given follow-up work: anyone whose role includes followup.manage. */
export async function followupTeam(tx: Tx, orgId: string) {
  return tx
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.status, "active"),
        sql`'followup.manage' = any(${roles.permissions})`,
      ),
    )
    .orderBy(asc(users.name));
}

/** Gives new work to whoever on the team has the fewest open cases. */
async function nextAssignee(tx: Tx, orgId: string) {
  const team = await followupTeam(tx, orgId);
  if (!team.length) return null;
  const load = await tx
    .select({ id: followups.assignedTo, n: count() })
    .from(followups)
    .where(and(inArray(followups.stage, ["new", "contacted", "visited"]), sql`${followups.assignedTo} is not null`))
    .groupBy(followups.assignedTo);
  const n = (id: string) => Number(load.find((l) => l.id === id)?.n ?? 0);
  return [...team].sort((a, b) => n(a.id) - n(b.id))[0]!.id;
}

async function openCaseFor(tx: Tx, memberId: string) {
  const [f] = await tx
    .select({ id: followups.id })
    .from(followups)
    .where(and(eq(followups.memberId, memberId), inArray(followups.stage, ["new", "contacted", "visited"])));
  return f?.id ?? null;
}

export async function openFollowup(
  tx: Tx,
  ctx: Actor | { system: string; orgId: string },
  input: {
    memberId: string;
    reason: "first_timer" | "absentee" | "new_convert" | "other";
    prayerRequest?: string | null;
    wantsVisit?: boolean;
    assignedTo?: string | null;
  },
) {
  const orgId = "system" in ctx ? ctx.orgId : ctx.org.id;
  const existing = await openCaseFor(tx, input.memberId);
  if (existing) return { id: existing, created: false };
  const assignedTo = input.assignedTo === undefined ? await nextAssignee(tx, orgId) : input.assignedTo;
  const [f] = await tx
    .insert(followups)
    .values({
      orgId,
      memberId: input.memberId,
      reason: input.reason,
      prayerRequest: encrypt(input.prayerRequest || null),
      wantsVisit: input.wantsVisit ?? false,
      assignedTo,
      // first contact within two days
      dueAt: new Date(Date.now() + 2 * 86400_000),
      createdBy: "system" in ctx ? null : ctx.user.id,
    })
    .returning({ id: followups.id });
  return { id: f!.id, created: true };
}

/* ---------- visitor card (public) ---------- */

export const visitorSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name.").max(80),
  lastName: z.string().trim().min(1, "Enter your surname.").max(80),
  gender: z.enum(["male", "female"], { message: "Choose one." }),
  phone: z
    .string()
    .trim()
    .refine((v) => !!normalizeNgPhone(v), "Enter a Nigerian number, e.g. 0803 123 4567."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email address."),
  area: z.string().trim().max(120).optional(),
  howHeard: z.string().trim().max(120).optional(),
  ageRange: z.enum(["under18", "18-25", "26-35", "36-50", "51+"]).optional().or(z.literal("")),
  prayerRequest: z.string().trim().max(1000).optional(),
  wantsVisit: z.boolean().default(false),
  wantsMembership: z.boolean().default(false),
  consentMessaging: z.boolean().default(false),
});
export type VisitorInput = z.input<typeof visitorSchema>;

export async function getVisitorLink(tx: Tx, ctx: Actor) {
  assertCan(ctx, "followup.manage", "manage the visitor card");
  const [l] = await tx
    .select()
    .from(publicLinks)
    .where(and(eq(publicLinks.orgId, ctx.org.id), eq(publicLinks.kind, "visitor_form"), isNull(publicLinks.revokedAt)));
  if (l) return l.token;
  const token = randomToken(12);
  await tx.insert(publicLinks).values({ token, orgId: ctx.org.id, kind: "visitor_form" });
  return token;
}

export async function rotateVisitorLink(tx: Tx, ctx: Actor) {
  assertCan(ctx, "followup.manage", "manage the visitor card");
  await tx
    .update(publicLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(publicLinks.orgId, ctx.org.id), eq(publicLinks.kind, "visitor_form"), isNull(publicLinks.revokedAt)));
  await audit(tx, ctx, {
    action: "visitor_link.rotated",
    summary: "Replaced the visitor card QR code (old codes stop working)",
  });
  return getVisitorLink(tx, ctx);
}

/**
 * A visitor fills the card on their phone. Returning visitors (same phone) are matched instead of duplicated.
 * Runs as the church (withOrg) but with no signed-in user.
 */
export async function submitVisitorCard(
  tx: Tx,
  org: { id: string; name: string },
  branchId: string,
  input: VisitorInput,
) {
  const v = visitorSchema.parse(input);
  const phone = normalizeNgPhone(v.phone)!;
  const [existing] = await tx
    .select({ id: members.id, stage: members.stage, firstName: members.firstName })
    .from(members)
    .where(and(eq(members.phoneHash, blindIndex(phone)!), isNull(members.deletedAt)))
    .limit(1);
  let memberId: string;
  let returning = false;
  if (existing) {
    memberId = existing.id;
    returning = true;
  } else {
    const actor = systemActor(org, "Visitor card", ["members.write"]);
    const m = await createMember(
      tx,
      actor,
      {
        branchId,
        firstName: v.firstName,
        lastName: v.lastName,
        gender: v.gender,
        phone,
        email: v.email || undefined,
        area: v.area || undefined,
        howHeard: v.howHeard || undefined,
        stage: "first_timer",
        consentMessaging: v.consentMessaging,
      },
      { allowDuplicate: true, method: "visitor card", quiet: true },
    );
    memberId = m.id;
  }
  const fu = await openFollowup(
    tx,
    { system: "Visitor card", orgId: org.id },
    {
      memberId,
      reason: "first_timer",
      prayerRequest: v.prayerRequest,
      wantsVisit: v.wantsVisit,
    },
  );
  if (v.prayerRequest)
    await prayerFromVisitorCard(tx, org.id, { memberId, name: `${v.firstName} ${v.lastName}`, body: v.prayerRequest, wantsContact: v.wantsVisit });
  if (v.prayerRequest && !fu.created)
    await tx.insert(followupNotes).values({
      orgId: org.id,
      followupId: fu.id,
      method: "note",
      body: encrypt(`Prayer request from visitor card: ${v.prayerRequest}`),
      authorName: "Visitor card",
    });
  await audit(
    tx,
    { system: "Visitor card", orgId: org.id },
    {
      action: returning ? "visitor.returned" : "visitor.registered",
      summary: `${v.firstName} ${v.lastName} filled the visitor card${returning ? " (already on record)" : ""}`,
      entityType: "member",
      entityId: memberId,
    },
  );
  if (v.email && v.consentMessaging)
    await enqueue(
      tx,
      "email.send",
      {
        to: v.email,
        subject: `Welcome to ${org.name}`,
        html: emailLayout({
          church: org.name,
          heading: `Thank you for worshipping with us, ${v.firstName}`,
          bodyHtml:
            p(
              `We're glad you came to ${org.name}. Someone from our team will reach out in the next few days to say hello.`,
            ) +
            (v.prayerRequest
              ? p("We have received your prayer request, and our prayer team will pray with you.")
              : "") +
            p("We hope to see you again soon."),
        }),
      },
      { orgId: org.id, dedupeKey: `welcome:${memberId}` },
    );
  return { firstName: v.firstName, returning };
}

/* ---------- the board ---------- */

export async function listFollowups(
  tx: Tx,
  ctx: Actor,
  f: { assignedTo?: string | "me" | "none"; reason?: string; includeClosed?: boolean } = {},
) {
  assertCan(ctx, "followup.manage", "see follow-up");
  const assignee = f.assignedTo === "me" ? ctx.user.id : f.assignedTo === "none" ? null : f.assignedTo;
  const rows = await tx
    .select({
      id: followups.id,
      stage: followups.stage,
      reason: followups.reason,
      wantsVisit: followups.wantsVisit,
      dueAt: followups.dueAt,
      lastContactAt: followups.lastContactAt,
      createdAt: followups.createdAt,
      assignedTo: followups.assignedTo,
      assigneeName: users.name,
      memberId: members.id,
      title: members.title,
      firstName: members.firstName,
      lastName: members.lastName,
      area: members.area,
      phoneEnc: members.phoneEnc,
      hasPrayer: sql<boolean>`${followups.prayerRequest} is not null`,
      overdue: sql<boolean>`coalesce(${followups.dueAt} < now() and ${followups.stage} in ('new', 'contacted'), false)`,
      notes: sql<number>`(select count(*)::int from ${followupNotes} n where n.followup_id = followups.id)`,
    })
    .from(followups)
    .innerJoin(members, eq(members.id, followups.memberId))
    .leftJoin(users, eq(users.id, followups.assignedTo))
    .where(
      and(
        isNull(members.deletedAt),
        branchScope(ctx, members.branchId),
        f.includeClosed ? undefined : ne(followups.stage, "closed"),
        f.assignedTo === "none"
          ? isNull(followups.assignedTo)
          : assignee
            ? eq(followups.assignedTo, assignee)
            : undefined,
        f.reason ? eq(followups.reason, f.reason as "first_timer") : undefined,
        // integrated cases leave the board after 30 days
        sql`not (${followups.stage} = 'integrated' and ${followups.updatedAt} < now() - interval '30 days')`,
      ),
    )
    .orderBy(asc(followups.dueAt), desc(followups.createdAt))
    .limit(500);
  return rows.map(({ phoneEnc, ...r }) => ({ ...r, phone: decrypt(phoneEnc) }));
}

export async function getFollowup(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "followup.manage", "see follow-up");
  const [f] = await tx
    .select({ f: followups, m: members, assigneeName: users.name })
    .from(followups)
    .innerJoin(members, eq(members.id, followups.memberId))
    .leftJoin(users, eq(users.id, followups.assignedTo))
    .where(eq(followups.id, id));
  if (!f) throw notFound("That follow-up");
  assertBranch(ctx, f.m.branchId);
  const notes = await tx
    .select()
    .from(followupNotes)
    .where(eq(followupNotes.followupId, id))
    .orderBy(desc(followupNotes.createdAt));
  return {
    id: f.f.id,
    stage: f.f.stage,
    reason: f.f.reason,
    wantsVisit: f.f.wantsVisit,
    dueAt: f.f.dueAt,
    createdAt: f.f.createdAt,
    assignedTo: f.f.assignedTo,
    assigneeName: f.assigneeName,
    prayerRequest: decrypt(f.f.prayerRequest),
    member: {
      id: f.m.id,
      title: f.m.title,
      firstName: f.m.firstName,
      lastName: f.m.lastName,
      phone: decrypt(f.m.phoneEnc),
      area: f.m.area,
      stage: f.m.stage,
      howHeard: f.m.howHeard,
      memberNo: f.m.memberNo,
    },
    notes: notes.map((n) => ({
      id: n.id,
      method: n.method,
      outcome: n.outcome,
      body: decrypt(n.body),
      authorName: n.authorName,
      createdAt: n.createdAt,
    })),
  };
}

export async function addNote(
  tx: Tx,
  ctx: Actor,
  id: string,
  input: {
    method: (typeof followupNotes.$inferInsert)["method"];
    outcome?: (typeof followupNotes.$inferInsert)["outcome"] | null;
    body?: string;
    nextDueDays?: number | null;
  },
) {
  assertCan(ctx, "followup.manage", "record follow-up");
  const [f] = await tx.select().from(followups).where(eq(followups.id, id));
  if (!f) throw notFound("That follow-up");
  await tx.insert(followupNotes).values({
    orgId: ctx.org.id,
    followupId: id,
    method: input.method,
    outcome: input.outcome ?? null,
    body: encrypt(input.body?.trim() || null),
    authorId: ctx.user.id,
    authorName: ctx.user.name,
  });
  const reached = input.method !== "note" && input.outcome !== "no_answer" && input.outcome !== "wrong_number";
  await tx
    .update(followups)
    .set({
      lastContactAt: input.method === "note" ? f.lastContactAt : new Date(),
      stage:
        f.stage === "new" && reached
          ? "contacted"
          : input.method === "visit" && f.stage === "contacted"
            ? "visited"
            : f.stage,
      dueAt: input.nextDueDays
        ? new Date(Date.now() + input.nextDueDays * 86400_000)
        : input.method === "note"
          ? f.dueAt
          : null,
      assignedTo: f.assignedTo ?? ctx.user.id,
    })
    .where(eq(followups.id, id));
}

export async function moveFollowup(tx: Tx, ctx: Actor, id: string, stage: FollowupStage, closedReason?: string) {
  assertCan(ctx, "followup.manage", "update follow-up");
  const [f] = await tx
    .select({ f: followups, m: members })
    .from(followups)
    .innerJoin(members, eq(members.id, followups.memberId))
    .where(eq(followups.id, id));
  if (!f) throw notFound("That follow-up");
  if (f.f.stage === stage) return;
  if (stage === "closed" && !closedReason?.trim())
    throw new AppError("Say why you're closing this, e.g. moved away.", { closedReason: "Required." });
  await tx
    .update(followups)
    .set({ stage, closedReason: stage === "closed" ? closedReason!.trim() : null })
    .where(eq(followups.id, id));
  if (stage === "integrated" && ["visitor", "first_timer", "second_timer"].includes(f.m.stage))
    await tx.update(members).set({ stage: "regular" }).where(eq(members.id, f.m.id));
  await audit(tx, ctx, {
    action: "followup.moved",
    summary: `Follow-up for ${f.m.firstName} ${f.m.lastName}: ${STAGE_TITLES[f.f.stage]} → ${STAGE_TITLES[stage]}${stage === "closed" ? ` (${closedReason})` : ""}`,
    entityType: "member",
    entityId: f.m.id,
  });
}

export async function assignFollowup(tx: Tx, ctx: Actor, id: string, userId: string | null) {
  assertCan(ctx, "followup.manage", "assign follow-up");
  if (userId) {
    const team = await followupTeam(tx, ctx.org.id);
    if (!team.some((t) => t.id === userId))
      throw new AppError("That person isn't on the follow-up team. Give their role follow-up access first.");
  }
  await tx.update(followups).set({ assignedTo: userId }).where(eq(followups.id, id));
}

export async function startFollowup(
  tx: Tx,
  ctx: Actor,
  memberId: string,
  reason: "first_timer" | "absentee" | "new_convert" | "other",
) {
  assertCan(ctx, "followup.manage", "start follow-up");
  const [m] = await tx.select().from(members).where(eq(members.id, memberId));
  if (!m) throw notFound("That member");
  assertBranch(ctx, m.branchId);
  const r = await openFollowup(tx, ctx, { memberId, reason });
  if (r.created)
    await audit(tx, ctx, {
      action: "followup.opened",
      summary: `Started follow-up for ${m.firstName} ${m.lastName}`,
      entityType: "member",
      entityId: memberId,
    });
  return r;
}

/** Opens follow-up for regular attenders who have missed three Sundays. Safe to run repeatedly. */
export async function openAbsenteeFollowups(tx: Tx, orgId: string) {
  const list = await absentees(tx, { branchIds: [] });
  let opened = 0;
  for (const a of list) {
    const r = await openFollowup(tx, { system: "Absentee check", orgId }, { memberId: a.id, reason: "absentee" });
    if (r.created) opened++;
  }
  return opened;
}

export async function followupCounts(tx: Tx, ctx: Actor) {
  const rows = await tx
    .select({ stage: followups.stage, n: count() })
    .from(followups)
    .innerJoin(members, eq(members.id, followups.memberId))
    .where(and(isNull(members.deletedAt), branchScope(ctx, members.branchId)))
    .groupBy(followups.stage);
  const overdue = await tx
    .select({ n: count() })
    .from(followups)
    .where(
      and(
        inArray(followups.stage, ["new", "contacted"]),
        sql`${followups.dueAt} < now()`,
        eq(followups.assignedTo, ctx.user.id),
      ),
    );
  return {
    byStage: Object.fromEntries(rows.map((r) => [r.stage, Number(r.n)])) as Record<string, number>,
    myOverdue: Number(overdue[0]?.n ?? 0),
  };
}
