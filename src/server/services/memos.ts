import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import {
  branches,
  expenseCategories,
  expenses,
  groups,
  memberships,
  members,
  memoComments,
  memoRouteSteps,
  memoSteps,
  memoTemplates,
  memoViews,
  memos,
  organisations,
  roles,
  users,
  MEMO_CATEGORIES,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { decrypt, encrypt } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, p } from "../emails/layout";
import { env } from "../env";
import { formatDate, naira, todayISO } from "@/lib/format";
import { memoVisibleTo } from "./memo-access";
import { assertBranch } from "./scope";

/* ================= labels and defaults ================= */

export const CATEGORY_LABEL: Record<(typeof MEMO_CATEGORIES)[number], string> = {
  requisition: "Requisition",
  welfare: "Welfare",
  event: "Event proposal",
  maintenance: "Maintenance",
  guest: "Guest minister",
  general: "General",
};

export const STARTER_TEMPLATES = [
  {
    name: "Requisition for funds",
    category: "requisition" as const,
    subject: "Request for funds: ",
    needsAmount: true,
    body: "Purpose of the request:\n\nBreakdown of costs:\n- \n\nWhen the money is needed:\n\nThe department will provide receipts after spending.",
  },
  {
    name: "Requisition for welfare",
    category: "welfare" as const,
    subject: "Welfare support for ",
    needsAmount: true,
    body: "Member in need:\n\nTheir situation (keep medical details brief):\n\nSupport requested:\n\nHas the church helped them before?",
  },
  {
    name: "Youth event proposal",
    category: "event" as const,
    subject: "Proposal: ",
    needsAmount: true,
    body: "Event and date:\n\nWho it's for and how many we expect:\n\nProgramme outline:\n\nBudget:\n- Venue:\n- Refreshments:\n- Publicity:\n\nVolunteers needed:",
  },
  {
    name: "Maintenance request",
    category: "maintenance" as const,
    subject: "Repair: ",
    needsAmount: true,
    body: "What needs fixing and where:\n\nHow urgent it is:\n\nQuotes received (attach at least three):\n1.\n2.\n3.\n\nRecommended vendor and why:",
  },
  {
    name: "Guest minister approval",
    category: "guest" as const,
    subject: "Invitation of guest minister: ",
    needsAmount: false,
    body: "Name and ministry:\n\nProposed date and service:\n\nWhy we recommend them:\n\nHonorarium and travel (if any):\n\nAccommodation needed?",
  },
];

export async function createMemoDefaults(tx: Tx, orgId: string) {
  await tx.insert(memoTemplates).values(STARTER_TEMPLATES.map((t) => ({ ...t, orgId })));
  await tx.insert(memoRouteSteps).values([
    { orgId, position: 1, label: "Church Administrator", roleKey: "admin", minAmountKobo: 0 },
    { orgId, position: 2, label: "Senior Pastor", roleKey: "pastor", minAmountKobo: 5_000_000 },
  ]);
}

/* ================= people who can act on a step ================= */

async function approversFor(tx: Tx, orgId: string, step: { roleKey: string | null; userId: string | null }, branchId: string) {
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, branchIds: memberships.branchIds, perms: roles.permissions })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.status, "active"),
        step.userId ? eq(memberships.userId, step.userId) : step.roleKey ? eq(roles.key, step.roleKey) : sql`false`,
      ),
    );
  return rows.filter((r) => (r.perms as string[]).includes("memo.approve") && (!r.branchIds.length || r.branchIds.includes(branchId)));
}

/** The person can act on this step: right role (or named), allowed to approve, and not the one who raised it. */
function canActOn(ctx: Actor, step: { roleKey: string | null; userId: string | null }, initiatorId: string) {
  if (ctx.user.id === initiatorId) return false;
  if (!ctx.can("memo.approve")) return false;
  return step.userId ? step.userId === ctx.user.id : step.roleKey === ctx.membership.roleKey;
}

/* ================= reference numbers ================= */

export async function memoPrefix(tx: Tx, orgId: string) {
  const [o] = await tx.select({ name: organisations.name, settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
  const saved = ((o?.settings ?? {}) as { memo?: { prefix?: string } }).memo?.prefix;
  if (saved) return saved;
  const initials = o!.name
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|and|church|ministry|ministries)$/i.test(w))
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 5);
  return initials || "CHURCH";
}

async function nextRef(tx: Tx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`memo_ref:${orgId}`}))`);
  const year = todayISO().slice(0, 4);
  const prefix = `${await memoPrefix(tx, orgId)}/MEMO/${year}/`;
  const [r] = await tx
    .select({ n: sql<number>`coalesce(max(substring(${memos.refNo} from '\\d+$')::int), 0)` })
    .from(memos)
    .where(ilike(memos.refNo, `%/MEMO/${year}/%`));
  return `${prefix}${String(Number(r?.n ?? 0) + 1).padStart(3, "0")}`;
}

/* ================= writing a memo ================= */

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

export const memoSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid("Choose a branch."),
  templateId: optUuid,
  category: z.enum(MEMO_CATEGORIES),
  title: z.string().trim().min(5, "Give the memo a clear subject.").max(160),
  body: z.string().trim().min(10, "Write what you're asking for.").max(20_000),
  amount: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, c) => {
      if (v === undefined || v === null || v === "") return null;
      const k = Math.round(Number(String(v).replace(/[₦,\s]/g, "")) * 100);
      if (!Number.isFinite(k) || k <= 0) {
        c.addIssue({ code: "custom", message: "Enter an amount above zero, or leave it empty." });
        return z.NEVER;
      }
      if (k > 100_000_000_000) {
        c.addIssue({ code: "custom", message: "That amount is too large. Check the zeros." });
        return z.NEVER;
      }
      return k;
    }),
  departmentId: optUuid,
  memberId: optUuid,
  urgent: z.boolean().default(false),
  confidential: z.boolean().default(false),
});
export type MemoInput = z.output<typeof memoSchema>;

/** Saves a draft, or the initiator's edits while a memo is queried. The browser picks the id, so double saves are safe. */
export async function saveMemo(tx: Tx, ctx: Actor, input: MemoInput) {
  assertCan(ctx, "memo.create", "raise memos");
  assertBranch(ctx, input.branchId);
  if (input.departmentId) {
    const [g] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, input.departmentId));
    if (!g) throw new AppError("That department no longer exists.", { departmentId: "Choose again." });
  }
  if (input.memberId) {
    const [m] = await tx.select({ id: members.id }).from(members).where(and(eq(members.id, input.memberId), isNull(members.deletedAt)));
    if (!m) throw new AppError("That member no longer exists.", { memberId: "Choose again." });
  }
  if (input.templateId) {
    const [t] = await tx.select().from(memoTemplates).where(eq(memoTemplates.id, input.templateId));
    if (t?.needsAmount && !input.amount) throw new AppError("This kind of memo needs an amount.", { amount: "Enter the amount requested." });
  }
  const values = {
    branchId: input.branchId,
    templateId: input.templateId,
    category: input.category,
    title: input.title,
    bodyEnc: encrypt(input.body)!,
    amountKobo: input.amount,
    departmentId: input.departmentId,
    memberId: input.memberId,
    urgent: input.urgent,
    confidential: input.confidential,
  };
  const [existing] = await tx.select().from(memos).where(eq(memos.id, input.id)).for("update");
  if (existing) {
    if (existing.initiatorId !== ctx.user.id) throw new AppError(`${existing.initiatorName} raised this memo, so only they can edit it.`);
    if (existing.status !== "draft" && existing.status !== "query") throw new AppError("This memo has been sent and can't be edited now.");
    await tx.update(memos).set(values).where(eq(memos.id, input.id));
  } else {
    await tx.insert(memos).values({ ...values, id: input.id, orgId: ctx.org.id, initiatorId: ctx.user.id, initiatorName: ctx.user.name });
  }
  await audit(tx, ctx, {
    action: existing ? "memo.edited" : "memo.drafted",
    summary: `${existing ? "Edited" : "Drafted"} memo "${input.title}"${input.amount ? ` (${naira(input.amount)})` : ""}`,
    entityType: "memo",
    entityId: input.id,
  });
  return input.id;
}

async function loadOwn(tx: Tx, ctx: Actor, id: string) {
  const [m] = await tx.select().from(memos).where(eq(memos.id, id)).for("update");
  if (!m) throw notFound("That memo");
  if (m.initiatorId !== ctx.user.id) throw new AppError(`${m.initiatorName} raised this memo, so only they can do that.`);
  return m;
}

/** Builds the approval path for this memo from the church's route, skipping steps it doesn't need. */
async function buildPath(tx: Tx, ctx: Actor, m: typeof memos.$inferSelect) {
  const route = await tx.select().from(memoRouteSteps).orderBy(asc(memoRouteSteps.position));
  const steps: (typeof memoSteps.$inferInsert)[] = [];
  const skipped: string[] = [];
  for (const r of route) {
    if (r.minAmountKobo > 0 && (m.amountKobo ?? 0) < r.minAmountKobo) continue;
    const people = (await approversFor(tx, ctx.org.id, r, m.branchId)).filter((x) => x.id !== m.initiatorId);
    if (!people.length) {
      skipped.push(r.label);
      continue;
    }
    steps.push({ orgId: ctx.org.id, memoId: m.id, position: steps.length + 1, label: r.label, roleKey: r.roleKey, userId: r.userId });
  }
  if (!steps.length) {
    // nobody on the route can approve it: the Super Admin decides
    const owners = (await approversFor(tx, ctx.org.id, { roleKey: "owner", userId: null }, m.branchId)).filter((x) => x.id !== m.initiatorId);
    if (owners.length) steps.push({ orgId: ctx.org.id, memoId: m.id, position: 1, label: "Super Admin", roleKey: "owner", userId: null });
  }
  return { steps, skipped };
}

export async function submitMemo(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "memo.create", "send memos");
  const m = await loadOwn(tx, ctx, id);
  if (m.status !== "draft") throw new AppError("This memo has already been sent.");
  const { steps, skipped } = await buildPath(tx, ctx, m);
  if (!steps.length) throw new AppError("There's no one else who can approve this memo. Invite an administrator or pastor first.");
  const refNo = await nextRef(tx, ctx.org.id);
  await tx.delete(memoSteps).where(eq(memoSteps.memoId, id));
  await tx.insert(memoSteps).values(steps.map((s, i) => ({ ...s, status: i === 0 ? ("current" as const) : ("waiting" as const) })));
  await tx.update(memos).set({ status: "pending", currentStep: 1, refNo, submittedAt: new Date() }).where(eq(memos.id, id));
  await tx.insert(memoComments).values({
    orgId: ctx.org.id,
    memoId: id,
    authorId: ctx.user.id,
    authorName: ctx.user.name,
    kind: "submitted",
    body: skipped.length ? `Sent for approval. Skipped ${skipped.join(", ")}: no one else holds that role.` : "Sent for approval.",
  });
  await notifyStep(tx, ctx, { ...m, refNo, currentStep: 1 }, 1);
  await audit(tx, ctx, {
    action: "memo.submitted",
    summary: `Sent memo ${refNo} "${m.title}" for approval (${steps.map((s) => s.label).join(" → ")})`,
    entityType: "memo",
    entityId: id,
  });
  return refNo;
}

async function notifyStep(tx: Tx, ctx: Actor, m: typeof memos.$inferSelect, position: number) {
  const [step] = await tx.select().from(memoSteps).where(and(eq(memoSteps.memoId, m.id), eq(memoSteps.position, position)));
  if (!step) return;
  const people = (await approversFor(tx, ctx.org.id, step, m.branchId)).filter((x) => x.id !== m.initiatorId);
  const url = `${env().APP_URL}/memos/${m.id}`;
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ctx.org.id));
  for (const a of people) {
    await enqueue(
      tx,
      "email.send",
      {
        to: a.email,
        subject: `${m.urgent ? "URGENT: " : ""}Memo ${m.refNo} needs your approval`,
        html: emailLayout({
          church: o!.name,
          preheader: m.title,
          heading: `${m.urgent ? "Urgent: " : ""}A memo needs your approval`,
          bodyHtml:
            p(`${m.initiatorName} sent memo ${m.refNo}: "${m.confidential ? "Confidential memo" : m.title}"${m.amountKobo ? `, asking for ${naira(m.amountKobo)}` : ""}.`) +
            p(`You're asked to approve it as ${step.label}.`),
          button: { label: "Open the memo", url },
        }),
      },
      { orgId: ctx.org.id, dedupeKey: `memo-step:${m.id}:${position}:${a.id}:${Date.now()}` },
    );
    // urgent memos also go by SMS to approvers with a phone on their account
    if (m.urgent && a.phone) {
      const { sendDirect } = await import("./messaging");
      await sendDirect(tx, ctx.org.id, {
        channel: "sms",
        to: a.phone,
        name: a.name,
        purpose: "memo",
        body: `${o!.name}: URGENT memo ${m.refNo} from ${m.initiatorName} needs your approval${m.amountKobo ? ` (N${(m.amountKobo / 100).toLocaleString("en-NG")})` : ""}. ${url}`,
      });
    }
  }
}

async function notifyInitiator(tx: Tx, ctx: Actor, m: typeof memos.$inferSelect, heading: string, line: string) {
  const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, m.initiatorId));
  if (!u) return;
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ctx.org.id));
  await enqueue(
    tx,
    "email.send",
    {
      to: u.email,
      subject: `Memo ${m.refNo}: ${heading.toLowerCase()}`,
      html: emailLayout({ church: o!.name, heading, bodyHtml: p(line), button: { label: "Open the memo", url: `${env().APP_URL}/memos/${m.id}` } }),
    },
    { orgId: ctx.org.id, dedupeKey: `memo-init:${m.id}:${Date.now()}` },
  );
}

async function currentStepFor(tx: Tx, ctx: Actor, id: string) {
  const m = await memoVisibleTo(tx, ctx, id);
  if (!m) throw notFound("That memo");
  if (m.status !== "pending" || !m.currentStep) throw new AppError("This memo isn't waiting for approval.");
  const [step] = await tx
    .select()
    .from(memoSteps)
    .where(and(eq(memoSteps.memoId, id), eq(memoSteps.position, m.currentStep)))
    .for("update");
  if (!step || !canActOn(ctx, step, m.initiatorId))
    throw new AppError(m.initiatorId === ctx.user.id ? "You raised this memo, so someone else must approve it." : `This step is for the ${step?.label ?? "next approver"}.`);
  return { m, step };
}

export const decisionSchema = z.object({
  id: z.string().uuid(),
  comment: optText(2000),
});

/** Approves the current step with a stamp; the memo moves on, or is approved when it was the last step. */
export async function approveMemo(tx: Tx, ctx: Actor, input: z.output<typeof decisionSchema>) {
  assertCan(ctx, "memo.approve", "approve memos");
  const { m, step } = await currentStepFor(tx, ctx, input.id);
  const at = new Date();
  const code = createHash("sha256")
    .update(`${m.id}|${step.position}|${ctx.user.id}|${at.toISOString()}|${m.bodyEnc}|${m.amountKobo ?? ""}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  await tx
    .update(memoSteps)
    .set({
      status: "approved",
      actedBy: ctx.user.id,
      actedByName: ctx.user.name,
      actedAt: at,
      comment: input.comment,
      stamp: { name: ctx.user.name, label: step.label, at: at.toISOString(), code },
    })
    .where(eq(memoSteps.id, step.id));
  const [next] = await tx.select().from(memoSteps).where(and(eq(memoSteps.memoId, m.id), eq(memoSteps.position, step.position + 1)));
  if (next) {
    await tx.update(memoSteps).set({ status: "current" }).where(eq(memoSteps.id, next.id));
    await tx.update(memos).set({ currentStep: next.position }).where(eq(memos.id, m.id));
    await notifyStep(tx, ctx, m, next.position);
  } else {
    await tx.update(memos).set({ status: "approved", decidedAt: at }).where(eq(memos.id, m.id));
    await notifyInitiator(tx, ctx, m, "Approved", `${ctx.user.name} gave the final approval to memo ${m.refNo} "${m.title}".`);
    if (m.amountKobo) await notifyFinance(tx, ctx, m);
  }
  await tx.insert(memoComments).values({ orgId: ctx.org.id, memoId: m.id, authorId: ctx.user.id, authorName: ctx.user.name, kind: "approved", body: input.comment });
  await audit(tx, ctx, {
    action: next ? "memo.step_approved" : "memo.approved",
    summary: `${next ? `Approved memo ${m.refNo} as ${step.label}; it moves to ${next.label}` : `Gave final approval to memo ${m.refNo}`} (stamp ${code})`,
    entityType: "memo",
    entityId: m.id,
  });
  return { final: !next };
}

async function notifyFinance(tx: Tx, ctx: Actor, m: typeof memos.$inferSelect) {
  const rows = await tx
    .select({ email: users.email, perms: roles.permissions, branchIds: memberships.branchIds })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.status, "active")));
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, ctx.org.id));
  for (const r of rows.filter((x) => (x.perms as string[]).includes("memo.disburse") && (!x.branchIds.length || x.branchIds.includes(m.branchId))))
    await enqueue(
      tx,
      "email.send",
      {
        to: r.email,
        subject: `Cleared for payment: memo ${m.refNo} (${naira(m.amountKobo!)})`,
        html: emailLayout({
          church: o!.name,
          heading: "Funds cleared for disbursement",
          bodyHtml: p(`Memo ${m.refNo} from ${m.initiatorName} is fully approved. ${naira(m.amountKobo!)} can now be paid.`),
          button: { label: "Record the payment", url: `${env().APP_URL}/memos/${m.id}` },
        }),
      },
      { orgId: ctx.org.id, dedupeKey: `memo-fin:${m.id}:${r.email}` },
    );
}

export const reasonSchema = z.object({ id: z.string().uuid(), comment: z.string().trim().min(5, "Say why, so they know what to do.").max(2000) });

export async function declineMemo(tx: Tx, ctx: Actor, input: z.output<typeof reasonSchema>) {
  assertCan(ctx, "memo.approve", "decline memos");
  const { m, step } = await currentStepFor(tx, ctx, input.id);
  const at = new Date();
  await tx.update(memoSteps).set({ status: "declined", actedBy: ctx.user.id, actedByName: ctx.user.name, actedAt: at, comment: input.comment }).where(eq(memoSteps.id, step.id));
  await tx.update(memos).set({ status: "declined", decidedAt: at }).where(eq(memos.id, m.id));
  await tx.insert(memoComments).values({ orgId: ctx.org.id, memoId: m.id, authorId: ctx.user.id, authorName: ctx.user.name, kind: "declined", body: input.comment });
  await notifyInitiator(tx, ctx, m, "Declined", `${ctx.user.name} declined memo ${m.refNo} "${m.title}": ${input.comment}`);
  await audit(tx, ctx, { action: "memo.declined", summary: `Declined memo ${m.refNo} as ${step.label}: ${input.comment}`, entityType: "memo", entityId: m.id });
}

/** Sends the memo back to whoever raised it with a question; it returns to the same step when they answer. */
export async function queryMemo(tx: Tx, ctx: Actor, input: z.output<typeof reasonSchema>) {
  assertCan(ctx, "memo.approve", "query memos");
  const { m, step } = await currentStepFor(tx, ctx, input.id);
  await tx.update(memoSteps).set({ status: "queried", comment: input.comment }).where(eq(memoSteps.id, step.id));
  await tx.update(memos).set({ status: "query" }).where(eq(memos.id, m.id));
  await tx.insert(memoComments).values({ orgId: ctx.org.id, memoId: m.id, authorId: ctx.user.id, authorName: ctx.user.name, kind: "query", body: input.comment });
  await notifyInitiator(tx, ctx, m, "Query raised", `${ctx.user.name} (${step.label}) has a question about memo ${m.refNo}: "${input.comment}"`);
  await audit(tx, ctx, { action: "memo.queried", summary: `Queried memo ${m.refNo}: ${input.comment}`, entityType: "memo", entityId: m.id });
}

export async function answerQuery(tx: Tx, ctx: Actor, input: z.output<typeof reasonSchema>) {
  assertCan(ctx, "memo.create", "answer queries");
  const m = await loadOwn(tx, ctx, input.id);
  if (m.status !== "query" || !m.currentStep) throw new AppError("There's no open query on this memo.");
  await tx.update(memoSteps).set({ status: "current", comment: null }).where(and(eq(memoSteps.memoId, m.id), eq(memoSteps.position, m.currentStep)));
  await tx.update(memos).set({ status: "pending" }).where(eq(memos.id, m.id));
  await tx.insert(memoComments).values({ orgId: ctx.org.id, memoId: m.id, authorId: ctx.user.id, authorName: ctx.user.name, kind: "response", body: input.comment });
  await notifyStep(tx, ctx, m, m.currentStep);
  await audit(tx, ctx, { action: "memo.answered", summary: `Answered the query on memo ${m.refNo}`, entityType: "memo", entityId: m.id });
}

export async function withdrawMemo(tx: Tx, ctx: Actor, input: z.output<typeof reasonSchema>) {
  const m = await loadOwn(tx, ctx, input.id);
  if (m.status !== "pending" && m.status !== "query") throw new AppError("Only memos still waiting for a decision can be withdrawn.");
  await tx.update(memos).set({ status: "withdrawn", decidedAt: new Date() }).where(eq(memos.id, m.id));
  await tx.update(memoSteps).set({ status: "skipped" }).where(and(eq(memoSteps.memoId, m.id), inArray(memoSteps.status, ["current", "waiting", "queried"])));
  await tx.insert(memoComments).values({ orgId: ctx.org.id, memoId: m.id, authorId: ctx.user.id, authorName: ctx.user.name, kind: "withdrawn", body: input.comment });
  await audit(tx, ctx, { action: "memo.withdrawn", summary: `Withdrew memo ${m.refNo}: ${input.comment}`, entityType: "memo", entityId: m.id });
}

export async function deleteDraft(tx: Tx, ctx: Actor, id: string) {
  const m = await loadOwn(tx, ctx, id);
  if (m.status !== "draft") throw new AppError("Only drafts can be deleted. Withdraw it instead.");
  await tx.delete(memos).where(eq(memos.id, id));
  await audit(tx, ctx, { action: "memo.deleted", summary: `Deleted draft memo "${m.title}"`, entityType: "memo", entityId: id });
}

export const commentSchema = z.object({ id: z.string().uuid(), body: z.string().trim().min(1, "Write a comment.").max(2000) });

export async function addComment(tx: Tx, ctx: Actor, input: z.output<typeof commentSchema>) {
  const m = await memoVisibleTo(tx, ctx, input.id);
  if (!m) throw notFound("That memo");
  await tx.insert(memoComments).values({ orgId: ctx.org.id, memoId: m.id, authorId: ctx.user.id, authorName: ctx.user.name, kind: "comment", body: input.body });
  await audit(tx, ctx, { action: "memo.commented", summary: `Commented on memo ${m.refNo ?? m.title}`, entityType: "memo", entityId: m.id });
}

/* ================= disbursement ================= */

export const disburseSchema = z.object({
  id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform((v, c) => {
    const k = Math.round(Number(String(v).replace(/[₦,\s]/g, "")) * 100);
    if (!Number.isFinite(k) || k <= 0) {
      c.addIssue({ code: "custom", message: "Enter the amount paid." });
      return z.NEVER;
    }
    return k;
  }),
  method: z.enum(["cash", "transfer", "cheque", "pos", "other"]),
  reference: optText(80),
  categoryId: optUuid,
  fundId: optUuid,
});

/**
 * Finance records the payment. With a category, it's also added to the expense ledger as paid, approved through
 * the memo, so the accounts stay complete.
 */
export async function disburseMemo(tx: Tx, ctx: Actor, input: z.output<typeof disburseSchema>) {
  assertCan(ctx, "memo.disburse", "record memo payments");
  const m = await memoVisibleTo(tx, ctx, input.id);
  if (!m) throw notFound("That memo");
  assertBranch(ctx, m.branchId);
  if (m.status !== "approved") throw new AppError("Only approved memos can be paid.");
  if (!m.amountKobo) throw new AppError("This memo didn't ask for money.");
  if (m.disbursedAt) throw new AppError("This memo has already been paid.");
  if (input.amount > m.amountKobo) throw new AppError(`That's more than the ${naira(m.amountKobo)} approved.`, { amount: "Pay the approved amount or less." });
  if (input.method !== "cash" && !input.reference) throw new AppError("Add the transfer or cheque reference.", { reference: "Enter the reference." });
  let expenseId: string | null = null;
  if (input.categoryId) {
    const [c] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, input.categoryId));
    if (!c) throw new AppError("Choose an expense category.", { categoryId: "Choose again." });
    const [last] = await tx
      .select({ actedBy: memoSteps.actedBy, actedByName: memoSteps.actedByName })
      .from(memoSteps)
      .where(and(eq(memoSteps.memoId, m.id), eq(memoSteps.status, "approved")))
      .orderBy(desc(memoSteps.position))
      .limit(1);
    const { nextExpenseNo } = await import("./expenses");
    const expenseNo = await nextExpenseNo(tx, ctx.org.id, Number(todayISO().slice(0, 4)));
    expenseId = randomUUID();
    const approver = last?.actedBy && last.actedBy !== ctx.user.id ? last : null;
    await tx.insert(expenses).values({
      id: expenseId,
      orgId: ctx.org.id,
      branchId: m.branchId,
      expenseNo,
      categoryId: input.categoryId,
      fundId: input.fundId,
      payee: m.initiatorName,
      description: `${m.refNo}: ${m.confidential ? "Confidential memo" : m.title}`,
      amountKobo: input.amount,
      spentOn: todayISO(),
      method: input.method,
      paymentRef: input.reference,
      status: "paid",
      requestedBy: ctx.user.id,
      requestedByName: ctx.user.name,
      submittedAt: new Date(),
      autoApproved: !approver,
      approvedBy: approver?.actedBy ?? ctx.user.id,
      approvedByName: approver?.actedByName ?? ctx.user.name,
      approvedAt: m.decidedAt,
      paidBy: ctx.user.id,
      paidByName: ctx.user.name,
      paidAt: new Date(),
      note: `Approved through memo ${m.refNo}`,
    });
  }
  await tx
    .update(memos)
    .set({ disbursedAt: new Date(), disbursedBy: ctx.user.id, disbursedByName: ctx.user.name, disbursedKobo: input.amount, disbursementRef: input.reference, expenseId })
    .where(eq(memos.id, m.id));
  await tx.insert(memoComments).values({
    orgId: ctx.org.id,
    memoId: m.id,
    authorId: ctx.user.id,
    authorName: ctx.user.name,
    kind: "disbursed",
    body: `Paid ${naira(input.amount)}${input.reference ? ` (ref ${input.reference})` : ""}.`,
  });
  await notifyInitiator(tx, ctx, m, "Paid", `${ctx.user.name} paid ${naira(input.amount)} for memo ${m.refNo}.`);
  await audit(tx, ctx, {
    action: "memo.disbursed",
    summary: `Paid ${naira(input.amount)} for memo ${m.refNo}${expenseId ? ", added to expenses" : ""}`,
    entityType: "memo",
    entityId: m.id,
  });
  return { expenseId };
}

/* ================= reading ================= */

export type MemoFilters = { box?: string; status?: string; q?: string; page?: number };

/**
 * Lists memos the person may see. "action": waiting on a step they can act on. "mine": raised by them.
 * Visibility for everything else follows the same rules as opening a memo.
 */
export async function listMemos(tx: Tx, ctx: Actor, f: MemoFilters) {
  assertCan(ctx, "memo.create", "use memos");
  const myStep = sql`exists (select 1 from memo_steps s where s.memo_id = memos.id and s.position = memos.current_step and s.status = 'current'
      and ((s.user_id is not null and s.user_id = ${ctx.user.id}) or (s.user_id is null and s.role_key = ${ctx.membership.roleKey})))`;
  const reachedMe = sql`exists (select 1 from memo_steps s where s.memo_id = memos.id and s.position <= coalesce(memos.current_step, 0)
      and (s.acted_by = ${ctx.user.id} or (s.user_id is not null and s.user_id = ${ctx.user.id}) or (s.user_id is null and s.role_key = ${ctx.membership.roleKey})))`;
  const canApprove = ctx.can("memo.approve");
  const seeAll = ctx.can("memo.view_confidential");
  const visible: SQL = or(
    eq(memos.initiatorId, ctx.user.id),
    seeAll ? ne(memos.status, "draft") : sql`false`,
    canApprove ? and(ne(memos.status, "draft"), reachedMe) : sql`false`,
    ctx.can("memo.disburse") ? and(eq(memos.status, "approved"), sql`${memos.amountKobo} is not null`) : sql`false`,
  )!;
  const q = f.q?.trim();
  const where = and(
    visible,
    ctx.branchIds.length ? inArray(memos.branchId, ctx.branchIds) : undefined,
    f.box === "action"
      ? canApprove
        ? and(eq(memos.status, "pending"), ne(memos.initiatorId, ctx.user.id), myStep)
        : sql`false`
      : f.box === "mine"
        ? eq(memos.initiatorId, ctx.user.id)
        : f.box === "pay"
          ? and(eq(memos.status, "approved"), sql`${memos.amountKobo} is not null`, isNull(memos.disbursedAt))
          : undefined,
    f.status && ["draft", "pending", "query", "approved", "declined", "withdrawn"].includes(f.status)
      ? eq(memos.status, f.status as "draft")
      : undefined,
    q ? or(ilike(memos.title, `%${q}%`), ilike(memos.refNo, `%${q}%`), ilike(memos.initiatorName, `%${q}%`)) : undefined,
  );
  const page = Math.max(1, f.page ?? 1);
  const rows = await tx
    .select({
      id: memos.id,
      refNo: memos.refNo,
      title: memos.title,
      category: memos.category,
      amountKobo: memos.amountKobo,
      urgent: memos.urgent,
      confidential: memos.confidential,
      status: memos.status,
      initiatorId: memos.initiatorId,
      initiatorName: memos.initiatorName,
      submittedAt: memos.submittedAt,
      createdAt: memos.createdAt,
      disbursedAt: memos.disbursedAt,
      stepLabel: sql<string | null>`(select s.label from memo_steps s where s.memo_id = memos.id and s.position = memos.current_step)`,
      stepOpened: sql<boolean>`(select s.opened_at is not null from memo_steps s where s.memo_id = memos.id and s.position = memos.current_step)`,
      departmentName: groups.name,
    })
    .from(memos)
    .leftJoin(groups, eq(groups.id, memos.departmentId))
    .where(where)
    .orderBy(desc(memos.urgent), desc(sql`coalesce(${memos.submittedAt}, ${memos.createdAt})`))
    .limit(25)
    .offset((page - 1) * 25);
  const [t] = await tx.select({ n: count() }).from(memos).where(where);
  return { rows, total: Number(t?.n ?? 0), page, pageSize: 25 };
}
export type MemoRow = Awaited<ReturnType<typeof listMemos>>["rows"][number];

export async function memoCounts(tx: Tx, ctx: Actor) {
  if (!ctx.can("memo.create")) return { action: 0, pay: 0 };
  const a = await listMemos(tx, ctx, { box: "action" });
  const p2 = ctx.can("memo.disburse") ? await listMemos(tx, ctx, { box: "pay" }) : { total: 0 };
  return { action: a.total, pay: p2.total };
}

/** Opens a memo: checks it's allowed, marks the step "under review" and records the view. */
export async function getMemo(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "memo.create", "use memos");
  const m = await memoVisibleTo(tx, ctx, id);
  if (!m) throw notFound("That memo");
  const steps = await tx.select().from(memoSteps).where(eq(memoSteps.memoId, id)).orderBy(asc(memoSteps.position));
  const current = steps.find((s) => s.position === m.currentStep);
  const canAct = m.status === "pending" && !!current && current.status === "current" && canActOn(ctx, current, m.initiatorId);
  if (canAct && !current.openedAt) await tx.update(memoSteps).set({ openedAt: new Date() }).where(eq(memoSteps.id, current.id));
  if (m.initiatorId !== ctx.user.id) {
    await tx
      .insert(memoViews)
      .values({ orgId: ctx.org.id, memoId: id, userId: ctx.user.id, userName: ctx.user.name })
      .onConflictDoUpdate({ target: [memoViews.memoId, memoViews.userId], set: { lastAt: new Date(), count: sql`${memoViews.count} + 1` } });
    if (m.confidential) await audit(tx, ctx, { action: "memo.viewed", summary: `Opened confidential memo ${m.refNo}`, entityType: "memo", entityId: id });
  }
  const comments = await tx.select().from(memoComments).where(eq(memoComments.memoId, id)).orderBy(asc(memoComments.createdAt));
  const views = await tx.select().from(memoViews).where(eq(memoViews.memoId, id)).orderBy(desc(memoViews.lastAt));
  const [b] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, m.branchId));
  const [dept] = m.departmentId ? await tx.select({ name: groups.name }).from(groups).where(eq(groups.id, m.departmentId)) : [];
  const [mem] = m.memberId
    ? await tx.select({ id: members.id, firstName: members.firstName, lastName: members.lastName, memberNo: members.memberNo }).from(members).where(eq(members.id, m.memberId))
    : [];
  const [exp] = m.expenseId ? await tx.select({ id: expenses.id, expenseNo: expenses.expenseNo }).from(expenses).where(eq(expenses.id, m.expenseId)) : [];
  const isMine = m.initiatorId === ctx.user.id;
  return {
    ...m,
    body: decrypt(m.bodyEnc) ?? "",
    bodyEnc: undefined,
    branchName: b?.name ?? "",
    departmentName: dept?.name ?? null,
    member: mem ?? null,
    expense: exp ?? null,
    steps,
    comments,
    views: isMine || ctx.can("memo.view_confidential") ? views : [],
    isMine,
    canAct,
    canEdit: isMine && (m.status === "draft" || m.status === "query"),
    canWithdraw: isMine && (m.status === "pending" || m.status === "query"),
    canDisburse: ctx.can("memo.disburse") && m.status === "approved" && !!m.amountKobo && !m.disbursedAt,
  };
}
export type MemoDetail = Awaited<ReturnType<typeof getMemo>>;

/* ================= templates, route and settings ================= */

export async function listMemoTemplates(tx: Tx) {
  return tx.select().from(memoTemplates).where(isNull(memoTemplates.archivedAt)).orderBy(asc(memoTemplates.name));
}

export async function listRoute(tx: Tx) {
  const steps = await tx.select().from(memoRouteSteps).orderBy(asc(memoRouteSteps.position));
  const roleRows = await tx.select({ key: roles.key, name: roles.name, perms: roles.permissions }).from(roles);
  return { steps, roles: roleRows.filter((r) => (r.perms as string[]).includes("memo.approve")).map((r) => ({ key: r.key, name: r.name })) };
}

export const routeSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "Use 2–10 letters or numbers, e.g. RCCG."),
  steps: z
    .array(
      z.object({
        label: z.string().trim().min(2, "Name the step.").max(60),
        roleKey: z.string().min(1, "Choose a role."),
        minAmount: z
          .union([z.string(), z.number()])
          .optional()
          .transform((v) => Math.max(0, Math.round(Number(String(v ?? "0").replace(/[₦,\s]/g, "")) * 100) || 0)),
      }),
    )
    .min(1, "Keep at least one approval step.")
    .max(8),
});

export async function saveRoute(tx: Tx, ctx: Actor, input: z.output<typeof routeSchema>) {
  assertCan(ctx, "settings.manage", "change the memo approval route");
  const known = new Set((await tx.select({ key: roles.key }).from(roles)).map((r) => r.key));
  input.steps.forEach((s, i) => {
    if (!known.has(s.roleKey)) throw new AppError("One of the roles no longer exists.", { [`steps.${i}.roleKey`]: "Choose again." });
  });
  await tx.delete(memoRouteSteps);
  await tx.insert(memoRouteSteps).values(input.steps.map((s, i) => ({ orgId: ctx.org.id, position: i + 1, label: s.label, roleKey: s.roleKey, minAmountKobo: s.minAmount })));
  await tx
    .update(organisations)
    .set({ settings: sql`jsonb_set(coalesce(${organisations.settings}, '{}'::jsonb), '{memo}', ${JSON.stringify({ prefix: input.prefix })}::jsonb)` })
    .where(eq(organisations.id, ctx.org.id));
  await audit(tx, ctx, {
    action: "memo.route_saved",
    summary: `Set the memo route: ${input.steps.map((s) => `${s.label}${s.minAmount ? ` (from ${naira(s.minAmount)})` : ""}`).join(" → ")}; references start ${input.prefix}/MEMO`,
    entityType: "organisation",
    entityId: ctx.org.id,
  });
}

export const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3, "Name the template.").max(80),
  category: z.enum(MEMO_CATEGORIES),
  subject: z.string().trim().max(160),
  body: z.string().trim().min(5, "Write the template.").max(5000),
  needsAmount: z.boolean().default(false),
});

export async function saveMemoTemplate(tx: Tx, ctx: Actor, input: z.output<typeof templateSchema>) {
  assertCan(ctx, "settings.manage", "manage memo templates");
  const values = { name: input.name, category: input.category, subject: input.subject, body: input.body, needsAmount: input.needsAmount };
  let id = input.id;
  if (id) await tx.update(memoTemplates).set(values).where(eq(memoTemplates.id, id));
  else id = (await tx.insert(memoTemplates).values({ ...values, orgId: ctx.org.id }).returning({ id: memoTemplates.id }))[0]!.id;
  await audit(tx, ctx, { action: "memo_template.saved", summary: `Saved memo template "${input.name}"`, entityType: "memo_template", entityId: id });
}

export async function archiveMemoTemplate(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "settings.manage", "manage memo templates");
  const [t] = await tx.update(memoTemplates).set({ archivedAt: new Date() }).where(eq(memoTemplates.id, id)).returning();
  if (!t) throw notFound("That template");
  await audit(tx, ctx, { action: "memo_template.removed", summary: `Removed memo template "${t.name}"`, entityType: "memo_template", entityId: id });
}

export const memoDate = (d: Date | string) => formatDate(d, "long");
