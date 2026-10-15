import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import {
  branches,
  givingBatchLines,
  givingBatches,
  givingFunds,
  givingTransactions,
  members,
  organisations,
  paymentIntents,
  pledgeCampaigns,
  pledges,
  services,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan, systemActor } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { PaymentsNotConfigured, paymentsProvider as providerName } from "../providers/payments";
import { grossUp as grossUpLocal } from "@/lib/fees";
import { formatDate, naira, todayISO } from "@/lib/format";
import { normalizeNgPhone } from "@/lib/phone";
import { assertBranch, branchScope } from "./scope";

/* ================= funds ================= */

export const DEFAULT_FUNDS = [
  { name: "Tithe", code: "TITHE", restricted: false, color: "c1" },
  { name: "Offering", code: "OFFERING", restricted: false, color: "c3" },
  { name: "Thanksgiving", code: "THANKS", restricted: false, color: "c4" },
  { name: "Building Fund", code: "BUILDING", restricted: true, color: "c5" },
  { name: "Welfare", code: "WELFARE", restricted: true, color: "c2" },
  { name: "Seed & Projects", code: "SEED", restricted: false, color: "c6" },
] as const;

export const FUND_COLORS = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;

export async function createDefaultFunds(tx: Tx, orgId: string) {
  await tx
    .insert(givingFunds)
    .values(DEFAULT_FUNDS.map((f, i) => ({ ...f, orgId, sortOrder: i + 1 })))
    .onConflictDoNothing();
}

export async function listFunds(tx: Tx, opts: { includeArchived?: boolean } = {}) {
  return tx
    .select()
    .from(givingFunds)
    .where(opts.includeArchived ? undefined : isNull(givingFunds.archivedAt))
    .orderBy(asc(givingFunds.sortOrder), asc(givingFunds.name));
}

export const fundSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Enter a name.").max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,16}$/, "2–16 letters or numbers, e.g. MISSIONS."),
  description: z.string().trim().max(300).optional(),
  restricted: z.boolean().default(false),
  online: z.boolean().default(true),
  color: z.enum(FUND_COLORS).default("c1"),
});

export async function saveFund(tx: Tx, ctx: Actor, input: z.output<typeof fundSchema>) {
  assertCan(ctx, "giving.verify", "manage funds");
  const clash = await tx
    .select({ id: givingFunds.id })
    .from(givingFunds)
    .where(and(eq(givingFunds.code, input.code), input.id ? ne(givingFunds.id, input.id) : undefined));
  if (clash.length) throw new AppError("Another fund already uses that code.", { code: "Choose a different code." });
  const values = {
    name: input.name,
    code: input.code,
    description: input.description || null,
    restricted: input.restricted,
    online: input.online,
    color: input.color,
  };
  if (input.id) {
    await tx.update(givingFunds).set(values).where(eq(givingFunds.id, input.id));
    await audit(tx, ctx, {
      action: "fund.updated",
      summary: `Updated fund ${input.name}`,
      entityType: "fund",
      entityId: input.id,
      after: values,
    });
    return input.id;
  }
  const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(givingFunds);
  const [f] = await tx
    .insert(givingFunds)
    .values({ ...values, orgId: ctx.org.id, sortOrder: Number(n) + 1 })
    .returning({ id: givingFunds.id });
  await audit(tx, ctx, { action: "fund.created", summary: `Added fund ${input.name}`, entityType: "fund", entityId: f!.id });
  return f!.id;
}

export async function archiveFund(tx: Tx, ctx: Actor, id: string, archived: boolean) {
  assertCan(ctx, "giving.verify", "manage funds");
  const [f] = await tx.select().from(givingFunds).where(eq(givingFunds.id, id));
  if (!f) throw notFound("That fund");
  if (archived) {
    const live = await tx
      .select({ id: givingFunds.id })
      .from(givingFunds)
      .where(and(isNull(givingFunds.archivedAt), ne(givingFunds.id, id)));
    if (!live.length) throw new AppError("Keep at least one fund open, or people will have nowhere to give.");
  }
  await tx
    .update(givingFunds)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(givingFunds.id, id));
  await audit(tx, ctx, {
    action: archived ? "fund.archived" : "fund.restored",
    summary: `${archived ? "Closed" : "Reopened"} fund ${f.name}`,
    entityType: "fund",
    entityId: id,
  });
}

/* ================= numbering ================= */

async function nextNumber(tx: Tx, orgId: string, kind: "batch" | "receipt", year: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`giving_no:${kind}:${orgId}`}))`);
  const prefix = `${kind === "batch" ? "B" : "R"}-${year}-`;
  const col = kind === "batch" ? givingBatches.batchNo : givingTransactions.receiptNo;
  const table = kind === "batch" ? givingBatches : givingTransactions;
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(substring(${col} from '\\d+$')::int), 0)` })
    .from(table)
    .where(ilike(col, `${prefix}%`));
  return `${prefix}${String(Number(row?.n ?? 0) + 1).padStart(kind === "batch" ? 4 : 6, "0")}`;
}

const yearOf = (isoDate: string) => Number(isoDate.slice(0, 4));
/** Paystack allows letters, numbers, "-", "." and "=" in references. */
export const newReference = () => `BMC-${randomBytes(8).toString("hex").toUpperCase()}`;

/* ================= batches: counted by one person, verified by another ================= */

export const BATCH_KIND_LABEL = { service: "Service collection", transfers: "Bank transfers", other: "Other" } as const;
export const CHANNEL_LABEL: Record<string, string> = {
  cash: "Cash",
  pos: "POS",
  transfer: "Bank transfer",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5] as const;

export const createBatchSchema = z.object({
  branchId: z.string().uuid("Choose a branch."),
  kind: z.enum(["service", "transfers", "other"]),
  serviceId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  label: z.string().trim().min(2, "Say what this collection was, e.g. Sunday First Service.").max(100),
  givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date."),
});

export async function createBatch(tx: Tx, ctx: Actor, input: z.output<typeof createBatchSchema>) {
  assertCan(ctx, "giving.record", "count collections");
  assertBranch(ctx, input.branchId);
  if (input.givenOn > todayISO()) throw new AppError("That date is in the future.", { givenOn: "Choose today or earlier." });
  const batchNo = await nextNumber(tx, ctx.org.id, "batch", yearOf(input.givenOn));
  const [b] = await tx
    .insert(givingBatches)
    .values({
      orgId: ctx.org.id,
      branchId: input.branchId,
      batchNo,
      kind: input.kind,
      serviceId: input.serviceId,
      label: input.label,
      givenOn: input.givenOn,
      countedBy: ctx.user.id,
      countedByName: ctx.user.name,
    })
    .returning({ id: givingBatches.id });
  await audit(tx, ctx, {
    action: "batch.created",
    summary: `Started counting ${batchNo} (${input.label}, ${input.givenOn})`,
    entityType: "giving_batch",
    entityId: b!.id,
  });
  return b!.id;
}

const naira2kobo = (v: unknown) => Math.round(Number(String(v ?? "").replace(/[₦,\s]/g, "")) * 100);
const amountField = z
  .union([z.string(), z.number()])
  .transform((v, c) => {
    const k = naira2kobo(v);
    if (!Number.isFinite(k) || k <= 0) {
      c.addIssue({ code: "custom", message: "Enter an amount above zero." });
      return z.NEVER;
    }
    if (k > 100_000_000_000) {
      c.addIssue({ code: "custom", message: "That amount is too large." });
      return z.NEVER;
    }
    return k;
  });

export const batchLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        fundId: z.string().uuid("Choose a fund."),
        channel: z.enum(["cash", "pos", "transfer", "cheque", "other"]),
        amount: amountField,
        memberId: z
          .string()
          .uuid()
          .optional()
          .or(z.literal(""))
          .transform((v) => v || null),
        donorName: z
          .string()
          .trim()
          .max(120)
          .optional()
          .transform((v) => v || null),
        note: z
          .string()
          .trim()
          .max(200)
          .optional()
          .transform((v) => v || null),
      }),
    )
    .max(2000),
  cashCount: z.record(z.string(), z.coerce.number().int().min(0).max(1_000_000)).nullish(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
});

async function loadBatch(tx: Tx, ctx: Actor, id: string) {
  const [b] = await tx.select().from(givingBatches).where(eq(givingBatches.id, id));
  if (!b) throw notFound("That batch");
  assertBranch(ctx, b.branchId);
  return b;
}

function assertCounter(ctx: Actor, b: typeof givingBatches.$inferSelect) {
  if (b.countedBy !== ctx.user.id)
    throw new AppError(`Only ${b.countedByName}, who started counting this batch, can change it.`);
  if (b.status !== "draft" && b.status !== "rejected")
    throw new AppError("This batch has been submitted. Ask a verifier to send it back if something needs changing.");
}

export const cashCountTotal = (cc: Record<string, number> | null | undefined) =>
  Object.entries(cc ?? {}).reduce((s, [denom, n]) => s + Number(denom) * 100 * Number(n || 0), 0);

export async function saveBatchLines(tx: Tx, ctx: Actor, id: string, input: z.output<typeof batchLinesSchema>) {
  assertCan(ctx, "giving.record", "count collections");
  const b = await loadBatch(tx, ctx, id);
  assertCounter(ctx, b);
  const fundIds = [...new Set(input.lines.map((l) => l.fundId))];
  if (fundIds.length) {
    const ok = await tx.select({ id: givingFunds.id }).from(givingFunds).where(inArray(givingFunds.id, fundIds));
    if (ok.length !== fundIds.length) throw new AppError("One of the funds no longer exists. Reload the page.");
  }
  // an envelope for a member with an open pledge in a project for that fund counts towards the project
  const campaigns = await activeCampaignsByFund(tx);
  await tx.delete(givingBatchLines).where(eq(givingBatchLines.batchId, id));
  if (input.lines.length)
    await tx.insert(givingBatchLines).values(
      input.lines.map((l) => ({
        orgId: ctx.org.id,
        batchId: id,
        fundId: l.fundId,
        channel: l.channel,
        amountKobo: l.amount,
        memberId: l.memberId,
        donorName: l.memberId ? null : l.donorName,
        campaignId: campaigns.get(l.fundId) ?? null,
        note: l.note,
      })),
    );
  const total = input.lines.reduce((s, l) => s + l.amount, 0);
  const cc = input.cashCount
    ? Object.fromEntries(Object.entries(input.cashCount).filter(([k, v]) => DENOMINATIONS.includes(Number(k) as never) && v > 0))
    : null;
  await tx
    .update(givingBatches)
    .set({ totalKobo: total, cashCount: cc && Object.keys(cc).length ? cc : null, notes: input.notes })
    .where(eq(givingBatches.id, id));
  return { total };
}

export async function submitBatch(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "giving.record", "count collections");
  const b = await loadBatch(tx, ctx, id);
  assertCounter(ctx, b);
  const lines = await tx.select().from(givingBatchLines).where(eq(givingBatchLines.batchId, id));
  if (!lines.length) throw new AppError("Add at least one amount before submitting.");
  const cash = lines.filter((l) => l.channel === "cash").reduce((s, l) => s + l.amountKobo, 0);
  if (b.cashCount) {
    const counted = cashCountTotal(b.cashCount);
    if (counted !== cash && !b.notes)
      throw new AppError(
        `The notes counted come to ${naira(counted)} but the cash lines add up to ${naira(cash)}. Fix the difference, or explain it in the notes before submitting.`,
      );
  }
  const total = lines.reduce((s, l) => s + l.amountKobo, 0);
  await tx
    .update(givingBatches)
    .set({ status: "submitted", submittedAt: new Date(), totalKobo: total, rejectionNote: null })
    .where(eq(givingBatches.id, id));
  await audit(tx, ctx, {
    action: "batch.submitted",
    summary: `Submitted ${b.batchNo} for verification: ${naira(total)}`,
    entityType: "giving_batch",
    entityId: id,
  });
}

export async function rejectBatch(tx: Tx, ctx: Actor, id: string, note: string) {
  assertCan(ctx, "giving.verify", "verify collections");
  const b = await loadBatch(tx, ctx, id);
  if (b.status !== "submitted") throw new AppError("Only submitted batches can be sent back.");
  if (b.countedBy === ctx.user.id) throw new AppError("You counted this batch, so someone else must check it.");
  await tx.update(givingBatches).set({ status: "rejected", rejectionNote: note }).where(eq(givingBatches.id, id));
  await audit(tx, ctx, {
    action: "batch.rejected",
    summary: `Sent ${b.batchNo} back to ${b.countedByName}: ${note}`,
    entityType: "giving_batch",
    entityId: id,
  });
}

export async function deleteBatch(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "giving.record", "count collections");
  const b = await loadBatch(tx, ctx, id);
  assertCounter(ctx, b);
  await tx.delete(givingBatchLines).where(eq(givingBatchLines.batchId, id));
  await tx.delete(givingBatches).where(eq(givingBatches.id, id));
  await audit(tx, ctx, {
    action: "batch.deleted",
    summary: `Deleted unsubmitted batch ${b.batchNo} (${b.label})`,
    entityType: "giving_batch",
    entityId: id,
  });
}

/**
 * Verifying posts the batch to the ledger. The person who counted it can't verify it:
 * the app refuses, and a database check refuses too.
 */
export async function verifyBatch(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "giving.verify", "verify collections");
  const b = await loadBatch(tx, ctx, id);
  if (b.status !== "submitted") throw new AppError("Only submitted batches can be verified.");
  if (b.countedBy === ctx.user.id) throw new AppError("You counted this batch, so someone else must verify it.");
  const lines = await tx
    .select()
    .from(givingBatchLines)
    .where(eq(givingBatchLines.batchId, id))
    .orderBy(asc(givingBatchLines.createdAt));
  const posted: (typeof givingTransactions.$inferSelect)[] = [];
  let i = 0;
  for (const l of lines) {
    i++;
    const [t] = await tx
      .insert(givingTransactions)
      .values({
        orgId: ctx.org.id,
        branchId: b.branchId,
        fundId: l.fundId,
        memberId: l.memberId,
        donorName: l.donorName,
        amountKobo: l.amountKobo,
        channel: l.channel,
        source: "batch",
        status: "confirmed",
        givenOn: b.givenOn,
        batchId: b.id,
        serviceId: b.serviceId,
        campaignId: l.campaignId,
        reference: `${b.batchNo}-${String(i).padStart(3, "0")}`,
        note: l.note,
        createdBy: ctx.user.id,
        confirmedAt: new Date(),
      })
      .returning();
    posted.push(t!);
  }
  await tx
    .update(givingBatches)
    .set({ status: "verified", verifiedBy: ctx.user.id, verifiedByName: ctx.user.name, verifiedAt: new Date() })
    .where(eq(givingBatches.id, id));
  const settings = await givingSettings(tx, ctx.org.id);
  for (const t of posted) {
    if (t.memberId) await linkPledge(tx, t);
    if (t.memberId && settings.receiptsForOffline) await issueReceipt(tx, ctx.org.id, t.id);
  }
  await audit(tx, ctx, {
    action: "batch.verified",
    summary: `Verified ${b.batchNo} (${b.label}) counted by ${b.countedByName}: ${naira(b.totalKobo)} posted`,
    entityType: "giving_batch",
    entityId: id,
  });
  return { posted: posted.length };
}

export async function listBatches(tx: Tx, ctx: Actor, f: { status?: string; page?: number } = {}) {
  if (!ctx.can("giving.record") && !ctx.can("giving.verify")) assertCan(ctx, "giving.read", "see collections");
  const pageSize = 25;
  const page = Math.max(1, f.page ?? 1);
  const status = ["draft", "submitted", "verified", "rejected"].includes(f.status ?? "")
    ? (f.status as "draft")
    : undefined;
  // counters see their own batches plus anything submitted; verifiers and readers see everything
  const own = !ctx.can("giving.verify") && !ctx.can("giving.read");
  const where = and(
    branchScope(ctx, givingBatches.branchId),
    status ? eq(givingBatches.status, status) : undefined,
    own ? eq(givingBatches.countedBy, ctx.user.id) : undefined,
  );
  const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(givingBatches).where(where);
  const rows = await tx
    .select({
      id: givingBatches.id,
      batchNo: givingBatches.batchNo,
      kind: givingBatches.kind,
      label: givingBatches.label,
      givenOn: givingBatches.givenOn,
      status: givingBatches.status,
      totalKobo: givingBatches.totalKobo,
      countedBy: givingBatches.countedBy,
      countedByName: givingBatches.countedByName,
      verifiedByName: givingBatches.verifiedByName,
      submittedAt: givingBatches.submittedAt,
      branchName: branches.name,
    })
    .from(givingBatches)
    .innerJoin(branches, eq(branches.id, givingBatches.branchId))
    .where(where)
    .orderBy(desc(givingBatches.givenOn), desc(givingBatches.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total: Number(n), page, pageSize };
}

export async function getBatch(tx: Tx, ctx: Actor, id: string) {
  if (!ctx.can("giving.record") && !ctx.can("giving.verify")) assertCan(ctx, "giving.read", "see collections");
  const b = await loadBatch(tx, ctx, id);
  const isCounter = b.countedBy === ctx.user.id;
  if (!ctx.can("giving.verify") && !ctx.can("giving.read") && !isCounter)
    throw new AppError("You can only open batches you counted.");
  const lines = await tx
    .select({
      l: givingBatchLines,
      fundName: givingFunds.name,
      memberTitle: members.title,
      memberFirst: members.firstName,
      memberLast: members.lastName,
      memberNo: members.memberNo,
    })
    .from(givingBatchLines)
    .innerJoin(givingFunds, eq(givingFunds.id, givingBatchLines.fundId))
    .leftJoin(members, eq(members.id, givingBatchLines.memberId))
    .where(eq(givingBatchLines.batchId, id))
    .orderBy(asc(givingBatchLines.createdAt));
  const showNames = isCounter || ctx.can("giving.read_named");
  const [svc] = b.serviceId
    ? await tx.select({ name: services.name }).from(services).where(eq(services.id, b.serviceId))
    : [];
  const [br] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, b.branchId));
  return {
    ...b,
    serviceName: svc?.name ?? null,
    branchName: br?.name ?? "",
    isCounter,
    canEdit: isCounter && (b.status === "draft" || b.status === "rejected") && ctx.can("giving.record"),
    canVerify: !isCounter && b.status === "submitted" && ctx.can("giving.verify"),
    lines: lines.map((r) => ({
      id: r.l.id,
      fundId: r.l.fundId,
      fundName: r.fundName,
      channel: r.l.channel,
      amountKobo: r.l.amountKobo,
      memberId: showNames ? r.l.memberId : null,
      named: Boolean(r.l.memberId || r.l.donorName),
      name: showNames
        ? r.l.memberId
          ? [r.memberTitle, r.memberFirst, r.memberLast].filter(Boolean).join(" ")
          : r.l.donorName
        : null,
      memberNo: showNames ? r.memberNo : null,
      note: r.l.note,
    })),
  };
}

/* ================= the ledger ================= */

export type TxFilters = {
  from?: string;
  to?: string;
  fundId?: string;
  channel?: string;
  status?: string;
  source?: string;
  q?: string;
  branchId?: string;
  memberId?: string;
  campaignId?: string;
  page?: number;
  pageSize?: number;
};

function txWhere(ctx: Actor, f: TxFilters): SQL | undefined {
  const w: (SQL | undefined)[] = [branchScope(ctx, givingTransactions.branchId)];
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (f.from && date.test(f.from)) w.push(gte(givingTransactions.givenOn, f.from));
  if (f.to && date.test(f.to)) w.push(lte(givingTransactions.givenOn, f.to));
  if (f.fundId) w.push(eq(givingTransactions.fundId, f.fundId));
  if (f.branchId) w.push(eq(givingTransactions.branchId, f.branchId));
  if (f.memberId) w.push(eq(givingTransactions.memberId, f.memberId));
  if (f.campaignId) w.push(eq(givingTransactions.campaignId, f.campaignId));
  if (f.channel && (["cash", "pos", "transfer", "cheque", "online", "other"] as string[]).includes(f.channel))
    w.push(eq(givingTransactions.channel, f.channel as "cash"));
  if (f.source === "online" || f.source === "batch" || f.source === "reversal") w.push(eq(givingTransactions.source, f.source));
  if (f.status === "pending" || f.status === "failed") w.push(eq(givingTransactions.status, f.status));
  else if (f.status === "reversed") w.push(sql`${givingTransactions.reversedAt} is not null`);
  else if (f.status !== "all") w.push(eq(givingTransactions.status, "confirmed"));
  const q = f.q?.trim();
  if (q && ctx.can("giving.read_named")) {
    w.push(
      or(
        ilike(givingTransactions.reference, `%${q}%`),
        ilike(givingTransactions.receiptNo, `%${q}%`),
        ilike(givingTransactions.donorName, `%${q}%`),
        sql`${givingTransactions.memberId} in (select id from ${members} where lower(${members.firstName} || ' ' || ${members.lastName}) like ${"%" + q.toLowerCase() + "%"})`,
      ),
    );
  } else if (q) w.push(or(ilike(givingTransactions.reference, `%${q}%`), ilike(givingTransactions.receiptNo, `%${q}%`)));
  return and(...w);
}

export async function listTransactions(tx: Tx, ctx: Actor, f: TxFilters) {
  assertCan(ctx, "giving.read", "see giving");
  const named = ctx.can("giving.read_named");
  const pageSize = Math.min(f.pageSize ?? 30, 200);
  const page = Math.max(1, f.page ?? 1);
  const where = txWhere(ctx, f);
  const [agg] = await tx
    .select({ n: count(), total: sql<number>`coalesce(sum(${givingTransactions.amountKobo}), 0)::bigint` })
    .from(givingTransactions)
    .where(where);
  const rows = await tx
    .select({
      t: givingTransactions,
      fundName: givingFunds.name,
      fundColor: givingFunds.color,
      branchName: branches.name,
      mTitle: members.title,
      mFirst: members.firstName,
      mLast: members.lastName,
    })
    .from(givingTransactions)
    .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
    .innerJoin(branches, eq(branches.id, givingTransactions.branchId))
    .leftJoin(members, eq(members.id, givingTransactions.memberId))
    .where(where)
    .orderBy(desc(givingTransactions.givenOn), desc(givingTransactions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    total: Number(agg?.n ?? 0),
    sumKobo: Number(agg?.total ?? 0),
    page,
    pageSize,
    rows: rows.map((r) => txRow(r, named)),
  };
}

function txRow(
  r: {
    t: typeof givingTransactions.$inferSelect;
    fundName: string;
    fundColor: string;
    branchName: string;
    mTitle: string | null;
    mFirst: string | null;
    mLast: string | null;
  },
  named: boolean,
) {
  const t = r.t;
  const memberName = r.mFirst ? [r.mTitle, r.mFirst, r.mLast].filter(Boolean).join(" ") : null;
  const label = t.anonymous
    ? "Anonymous"
    : named
      ? (memberName ?? t.donorName ?? (t.source === "batch" ? "Collection" : "Online giver"))
      : t.memberId || t.donorName
        ? "Named gift"
        : t.source === "batch"
          ? "Collection"
          : "Online giver";
  return {
    id: t.id,
    givenOn: String(t.givenOn),
    createdAt: t.createdAt.toISOString(),
    amountKobo: t.amountKobo,
    feeKobo: t.feeKobo,
    channel: t.channel,
    gatewayChannel: t.gatewayChannel,
    source: t.source,
    status: t.status,
    reference: t.reference,
    receiptNo: t.receiptNo,
    fundName: r.fundName,
    fundColor: r.fundColor,
    branchName: r.branchName,
    batchId: t.batchId,
    memberId: named ? t.memberId : null,
    giver: label,
    reversed: Boolean(t.reversedAt),
    reversalOf: t.reversalOf,
    note: named ? t.note : null,
  };
}
export type TxRow = ReturnType<typeof txRow>;

export async function exportTransactions(tx: Tx, ctx: Actor, f: TxFilters) {
  assertCan(ctx, "giving.read", "export giving");
  const named = ctx.can("giving.read_named");
  const rows = await tx
    .select({
      t: givingTransactions,
      fundName: givingFunds.name,
      fundColor: givingFunds.color,
      branchName: branches.name,
      mTitle: members.title,
      mFirst: members.firstName,
      mLast: members.lastName,
    })
    .from(givingTransactions)
    .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
    .innerJoin(branches, eq(branches.id, givingTransactions.branchId))
    .leftJoin(members, eq(members.id, givingTransactions.memberId))
    .where(txWhere(ctx, { ...f, page: 1 }))
    .orderBy(asc(givingTransactions.givenOn), asc(givingTransactions.createdAt))
    .limit(100_000);
  await audit(tx, ctx, {
    action: "giving.exported",
    summary: `Exported ${rows.length} giving record${rows.length === 1 ? "" : "s"}${named ? " with giver names" : ""}`,
    entityType: "giving_transaction",
    after: { filters: f, count: rows.length },
  });
  return rows.map((r) => {
    const x = txRow(r, named);
    return {
      Date: x.givenOn,
      Reference: x.reference,
      Receipt: x.receiptNo ?? "",
      Fund: x.fundName,
      Branch: x.branchName,
      Giver: x.giver,
      Channel: CHANNEL_LABEL[x.channel] ?? x.channel,
      Source: x.source,
      Status: x.reversed ? "reversed" : x.status,
      "Amount (₦)": x.amountKobo / 100,
      "Fee (₦)": x.feeKobo / 100,
      "Net (₦)": (x.amountKobo - x.feeKobo) / 100,
    };
  });
}

/** Corrections never edit a gift: they add an opposite entry and mark the original as reversed. */
export async function reverseTransaction(tx: Tx, ctx: Actor, id: string, reason: string) {
  assertCan(ctx, "giving.reverse", "reverse gifts");
  const [t] = await tx.select().from(givingTransactions).where(eq(givingTransactions.id, id)).for("update");
  if (!t) throw notFound("That gift");
  assertBranch(ctx, t.branchId);
  if (t.status !== "confirmed") throw new AppError("Only confirmed gifts can be reversed.");
  if (t.reversalOf) throw new AppError("This entry is itself a reversal and can't be reversed.");
  if (t.reversedAt) throw new AppError("This gift has already been reversed.");
  const today = todayISO();
  const [r] = await tx
    .insert(givingTransactions)
    .values({
      orgId: t.orgId,
      branchId: t.branchId,
      fundId: t.fundId,
      memberId: t.memberId,
      donorName: t.donorName,
      anonymous: t.anonymous,
      amountKobo: -t.amountKobo,
      feeKobo: t.feeKobo ? -t.feeKobo : 0,
      channel: t.channel,
      source: "reversal",
      status: "confirmed",
      givenOn: today,
      batchId: null,
      campaignId: t.campaignId,
      pledgeId: t.pledgeId,
      reference: `${t.reference}-R`,
      reversalOf: t.id,
      note: reason,
      createdBy: ctx.user.id,
      confirmedAt: new Date(),
    })
    .returning({ id: givingTransactions.id });
  await tx
    .update(givingTransactions)
    .set({ reversedAt: new Date(), reversedBy: ctx.user.id })
    .where(eq(givingTransactions.id, id));
  if (t.pledgeId) await refreshPledgeStatus(tx, t.pledgeId);
  await audit(tx, ctx, {
    action: "giving.reversed",
    summary: `Reversed ${t.reference} (${naira(t.amountKobo)}): ${reason}`,
    entityType: "giving_transaction",
    entityId: id,
    after: { reversalId: r!.id, reason },
  });
  return { id: r!.id, online: t.source === "online" };
}

/** Links an unnamed gift (a bank transfer, an online gift) to a member's giving record. */
export async function assignGiver(tx: Tx, ctx: Actor, id: string, memberId: string | null) {
  assertCan(ctx, "giving.read_named", "see who gave");
  assertCan(ctx, "giving.verify", "change giving records");
  const [t] = await tx.select().from(givingTransactions).where(eq(givingTransactions.id, id));
  if (!t) throw notFound("That gift");
  if (t.reversalOf) throw new AppError("Change the original gift, not its reversal.");
  if (memberId) {
    const [m] = await tx.select({ id: members.id }).from(members).where(eq(members.id, memberId));
    if (!m) throw notFound("That member");
  }
  await tx.update(givingTransactions).set({ memberId }).where(eq(givingTransactions.id, id));
  await tx.update(givingTransactions).set({ memberId }).where(eq(givingTransactions.reversalOf, id));
  if (memberId && t.status === "confirmed") await linkPledge(tx, { ...t, memberId });
  await audit(tx, ctx, {
    action: "giving.giver_assigned",
    summary: `${memberId ? "Linked" : "Unlinked"} ${t.reference} ${memberId ? "to a member" : "from its member"}`,
    entityType: "giving_transaction",
    entityId: id,
    before: { memberId: t.memberId },
    after: { memberId },
  });
}

/* ================= reports ================= */

const confirmed = eq(givingTransactions.status, "confirmed");

export async function givingSummary(tx: Tx, ctx: Actor, today = todayISO()) {
  assertCan(ctx, "giving.read", "see giving");
  const scope = and(confirmed, branchScope(ctx, givingTransactions.branchId));
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const monthStart = `${today.slice(0, 7)}-01`;
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevStart = prev.toISOString().slice(0, 10);
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const prevSameDay = `${prevStart.slice(0, 8)}${String(Math.min(d, prevDays)).padStart(2, "0")}`;
  const prevEnd = `${prevStart.slice(0, 8)}${String(prevDays).padStart(2, "0")}`;
  const yearStart = `${y}-01-01`;

  const totals = await tx
    .select({
      mtd: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} >= ${monthStart}), 0)::bigint`,
      prevSamePoint: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} between ${prevStart} and ${prevSameDay}), 0)::bigint`,
      prevMonth: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} between ${prevStart} and ${prevEnd}), 0)::bigint`,
      ytd: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} >= ${yearStart}), 0)::bigint`,
      onlineMtd: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} >= ${monthStart} and ${givingTransactions.channel} = 'online'), 0)::bigint`,
      giversMtd: sql<number>`count(distinct ${givingTransactions.memberId}) filter (where ${givingTransactions.givenOn} >= ${monthStart})::int`,
    })
    .from(givingTransactions)
    .where(and(scope, gte(givingTransactions.givenOn, prevStart < yearStart ? prevStart : yearStart)));

  const byFund = await tx
    .select({
      fundId: givingFunds.id,
      name: givingFunds.name,
      color: givingFunds.color,
      restricted: givingFunds.restricted,
      mtd: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} >= ${monthStart}), 0)::bigint`,
      prev: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} between ${prevStart} and ${prevEnd}), 0)::bigint`,
      ytd: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${givingTransactions.givenOn} >= ${yearStart}), 0)::bigint`,
    })
    .from(givingFunds)
    .leftJoin(
      givingTransactions,
      and(eq(givingTransactions.fundId, givingFunds.id), scope, gte(givingTransactions.givenOn, prevStart < yearStart ? prevStart : yearStart)),
    )
    .where(isNull(givingFunds.archivedAt))
    .groupBy(givingFunds.id)
    .orderBy(asc(givingFunds.sortOrder));

  const byChannel = await tx
    .select({ channel: givingTransactions.channel, total: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .where(and(scope, gte(givingTransactions.givenOn, monthStart)))
    .groupBy(givingTransactions.channel);

  // weeks run Sunday to Saturday, labelled by their Sunday
  const weekly = await tx.execute<{ week: string; fund_id: string; total: string }>(sql`
    select (date_trunc('week', ${givingTransactions.givenOn} + 1)::date - 1)::text as week, ${givingTransactions.fundId} as fund_id,
      sum(${givingTransactions.amountKobo})::bigint as total
    from ${givingTransactions}
    where ${scope!} and ${givingTransactions.givenOn} > ${today}::date - 84
    group by 1, 2 order by 1`);

  const t = totals[0]!;
  return {
    mtd: Number(t.mtd),
    prevSamePoint: Number(t.prevSamePoint),
    prevMonth: Number(t.prevMonth),
    ytd: Number(t.ytd),
    onlineMtd: Number(t.onlineMtd),
    giversMtd: Number(t.giversMtd),
    byFund: byFund.map((f) => ({ ...f, mtd: Number(f.mtd), prev: Number(f.prev), ytd: Number(f.ytd) })),
    byChannel: byChannel.map((c) => ({ channel: c.channel, total: Number(c.total) })),
    weekly: (weekly as unknown as { week: string; fund_id: string; total: string }[]).map((w) => ({
      week: w.week,
      fundId: w.fund_id,
      total: Number(w.total),
    })),
  };
}

export async function pendingBatchCount(tx: Tx, ctx: Actor) {
  const [r] = await tx
    .select({ n: count() })
    .from(givingBatches)
    .where(
      and(
        eq(givingBatches.status, "submitted"),
        ne(givingBatches.countedBy, ctx.user.id),
        branchScope(ctx, givingBatches.branchId),
      ),
    );
  return Number(r?.n ?? 0);
}

/** A member's giving, for their profile and annual statement. */
export async function memberGiving(tx: Tx, ctx: Actor, memberId: string, year?: number) {
  assertCan(ctx, "giving.read_named", "see who gave what");
  const y = year ?? Number(todayISO().slice(0, 4));
  const rows = await tx
    .select({
      id: givingTransactions.id,
      givenOn: givingTransactions.givenOn,
      amountKobo: givingTransactions.amountKobo,
      fundName: givingFunds.name,
      channel: givingTransactions.channel,
      reference: givingTransactions.reference,
      receiptNo: givingTransactions.receiptNo,
      reversed: sql<boolean>`${givingTransactions.reversedAt} is not null`,
      reversalOf: givingTransactions.reversalOf,
    })
    .from(givingTransactions)
    .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
    .where(
      and(
        eq(givingTransactions.memberId, memberId),
        confirmed,
        gte(givingTransactions.givenOn, `${y}-01-01`),
        lte(givingTransactions.givenOn, `${y}-12-31`),
      ),
    )
    .orderBy(asc(givingTransactions.givenOn));
  const byFund = new Map<string, number>();
  for (const r of rows) byFund.set(r.fundName, (byFund.get(r.fundName) ?? 0) + r.amountKobo);
  const total = rows.reduce((s, r) => s + r.amountKobo, 0);
  const months = new Set(rows.filter((r) => r.amountKobo > 0).map((r) => String(r.givenOn).slice(0, 7))).size;
  return {
    year: y,
    rows: rows.map((r) => ({ ...r, givenOn: String(r.givenOn) })),
    byFund: [...byFund.entries()].map(([fund, amount]) => ({ fund, amount })).filter((x) => x.amount !== 0),
    total,
    monthsGiven: months,
  };
}

/* ================= pledges ================= */

async function activeCampaignsByFund(tx: Tx) {
  const rows = await tx
    .select({ id: pledgeCampaigns.id, fundId: pledgeCampaigns.fundId })
    .from(pledgeCampaigns)
    .where(eq(pledgeCampaigns.status, "active"))
    .orderBy(asc(pledgeCampaigns.createdAt));
  const map = new Map<string, string>();
  for (const r of rows) if (!map.has(r.fundId)) map.set(r.fundId, r.id);
  return map;
}

/** Attaches a member's gift to their open pledge in the project it went to. */
async function linkPledge(tx: Tx, t: typeof givingTransactions.$inferSelect) {
  if (!t.memberId || t.pledgeId || t.amountKobo <= 0) return;
  const campaignId = t.campaignId ?? (await activeCampaignsByFund(tx)).get(t.fundId);
  if (!campaignId) return;
  const [pl] = await tx
    .select({ id: pledges.id })
    .from(pledges)
    .where(and(eq(pledges.campaignId, campaignId), eq(pledges.memberId, t.memberId), eq(pledges.status, "open")))
    .orderBy(asc(pledges.createdAt))
    .limit(1);
  await tx
    .update(givingTransactions)
    .set({ pledgeId: pl?.id ?? null, campaignId })
    .where(eq(givingTransactions.id, t.id));
  if (pl) await refreshPledgeStatus(tx, pl.id);
}

async function refreshPledgeStatus(tx: Tx, pledgeId: string) {
  const [pl] = await tx.select().from(pledges).where(eq(pledges.id, pledgeId));
  if (!pl || pl.status === "cancelled") return;
  const [paid] = await tx
    .select({ s: sum(givingTransactions.amountKobo) })
    .from(givingTransactions)
    .where(and(eq(givingTransactions.pledgeId, pledgeId), confirmed));
  const next = Number(paid?.s ?? 0) >= pl.amountKobo ? "fulfilled" : "open";
  if (next !== pl.status) await tx.update(pledges).set({ status: next }).where(eq(pledges.id, pledgeId));
}

export const campaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3, "Name the project.").max(100),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
  fundId: z.string().uuid("Choose the fund gifts go into."),
  goal: amountField,
  startsOn: z
    .string()
    .optional()
    .transform((v) => v || null),
  endsOn: z
    .string()
    .optional()
    .transform((v) => v || null),
  showOnline: z.boolean().default(true),
});

export async function saveCampaign(tx: Tx, ctx: Actor, input: z.output<typeof campaignSchema>) {
  assertCan(ctx, "giving.verify", "manage projects");
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn)
    throw new AppError("The end date is before the start date.", { endsOn: "Choose a later date." });
  const values = {
    name: input.name,
    description: input.description,
    fundId: input.fundId,
    goalKobo: input.goal,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    showOnline: input.showOnline,
  };
  if (input.id) {
    await tx.update(pledgeCampaigns).set(values).where(eq(pledgeCampaigns.id, input.id));
    await audit(tx, ctx, {
      action: "campaign.updated",
      summary: `Updated project ${input.name}`,
      entityType: "campaign",
      entityId: input.id,
    });
    return input.id;
  }
  const [c] = await tx
    .insert(pledgeCampaigns)
    .values({ ...values, orgId: ctx.org.id, createdBy: ctx.user.id })
    .returning({ id: pledgeCampaigns.id });
  await audit(tx, ctx, {
    action: "campaign.created",
    summary: `Started project ${input.name} with a goal of ${naira(input.goal)}`,
    entityType: "campaign",
    entityId: c!.id,
  });
  return c!.id;
}

export async function setCampaignStatus(tx: Tx, ctx: Actor, id: string, status: "active" | "closed") {
  assertCan(ctx, "giving.verify", "manage projects");
  const [c] = await tx.select().from(pledgeCampaigns).where(eq(pledgeCampaigns.id, id));
  if (!c) throw notFound("That project");
  await tx.update(pledgeCampaigns).set({ status }).where(eq(pledgeCampaigns.id, id));
  await audit(tx, ctx, {
    action: status === "closed" ? "campaign.closed" : "campaign.reopened",
    summary: `${status === "closed" ? "Closed" : "Reopened"} project ${c.name}`,
    entityType: "campaign",
    entityId: id,
  });
}

const raisedSql = sql<number>`coalesce((select sum(t.amount_kobo) from ${givingTransactions} t where t.campaign_id = ${pledgeCampaigns.id} and t.status = 'confirmed'), 0)::bigint`;
const pledgedSql = sql<number>`coalesce((select sum(p.amount_kobo) from ${pledges} p where p.campaign_id = ${pledgeCampaigns.id} and p.status <> 'cancelled'), 0)::bigint`;
const pledgersSql = sql<number>`(select count(*) from ${pledges} p where p.campaign_id = ${pledgeCampaigns.id} and p.status <> 'cancelled')::int`;

export async function listCampaigns(tx: Tx, ctx: Actor | null, opts: { onlineOnly?: boolean } = {}) {
  if (ctx) assertCan(ctx, "giving.read", "see projects");
  const rows = await tx
    .select({
      id: pledgeCampaigns.id,
      name: pledgeCampaigns.name,
      description: pledgeCampaigns.description,
      fundId: pledgeCampaigns.fundId,
      fundName: givingFunds.name,
      goalKobo: pledgeCampaigns.goalKobo,
      startsOn: pledgeCampaigns.startsOn,
      endsOn: pledgeCampaigns.endsOn,
      status: pledgeCampaigns.status,
      showOnline: pledgeCampaigns.showOnline,
      raised: raisedSql,
      pledged: pledgedSql,
      pledgers: pledgersSql,
    })
    .from(pledgeCampaigns)
    .innerJoin(givingFunds, eq(givingFunds.id, pledgeCampaigns.fundId))
    .where(opts.onlineOnly ? and(eq(pledgeCampaigns.status, "active"), eq(pledgeCampaigns.showOnline, true)) : undefined)
    .orderBy(asc(pledgeCampaigns.status), desc(pledgeCampaigns.createdAt));
  return rows.map((r) => ({
    ...r,
    raised: Number(r.raised),
    pledged: Number(r.pledged),
    startsOn: r.startsOn ? String(r.startsOn) : null,
    endsOn: r.endsOn ? String(r.endsOn) : null,
  }));
}

export async function getCampaign(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "giving.read", "see projects");
  const [c] = (await listCampaigns(tx, ctx)).filter((x) => x.id === id);
  if (!c) throw notFound("That project");
  const named = ctx.can("giving.read_named");
  const rows = await tx
    .select({
      p: pledges,
      paid: sql<number>`coalesce((select sum(t.amount_kobo) from ${givingTransactions} t where t.pledge_id = ${pledges.id} and t.status = 'confirmed'), 0)::bigint`,
      memberNo: members.memberNo,
    })
    .from(pledges)
    .leftJoin(members, eq(members.id, pledges.memberId))
    .where(eq(pledges.campaignId, id))
    .orderBy(asc(pledges.status), asc(pledges.pledgerName));
  return {
    ...c,
    pledges: rows.map((r) => ({
      id: r.p.id,
      memberId: named ? r.p.memberId : null,
      name: named ? r.p.pledgerName : "Pledger",
      memberNo: named ? r.memberNo : null,
      amountKobo: r.p.amountKobo,
      paidKobo: Number(r.paid),
      dueOn: r.p.dueOn ? String(r.p.dueOn) : null,
      status: r.p.status,
      note: named ? r.p.note : null,
    })),
  };
}

export const pledgeSchema = z.object({
  campaignId: z.string().uuid(),
  memberId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  pledgerName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  amount: amountField,
  dueOn: z
    .string()
    .optional()
    .transform((v) => v || null),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

export async function addPledge(tx: Tx, ctx: Actor, input: z.output<typeof pledgeSchema>) {
  assertCan(ctx, "giving.record", "record pledges");
  assertCan(ctx, "giving.read_named", "record who pledged");
  const [c] = await tx.select().from(pledgeCampaigns).where(eq(pledgeCampaigns.id, input.campaignId));
  if (!c) throw notFound("That project");
  if (c.status !== "active") throw new AppError("This project is closed. Reopen it to take new pledges.");
  let name = input.pledgerName;
  if (input.memberId) {
    const [m] = await tx
      .select({ title: members.title, firstName: members.firstName, lastName: members.lastName })
      .from(members)
      .where(eq(members.id, input.memberId));
    if (!m) throw notFound("That member");
    name = [m.title, m.firstName, m.lastName].filter(Boolean).join(" ");
  }
  if (!name) throw new AppError("Choose a member or type the pledger's name.", { pledgerName: "Who made this pledge?" });
  const [pl] = await tx
    .insert(pledges)
    .values({
      orgId: ctx.org.id,
      campaignId: c.id,
      memberId: input.memberId,
      pledgerName: name,
      amountKobo: input.amount,
      dueOn: input.dueOn,
      note: input.note,
      createdBy: ctx.user.id,
    })
    .returning({ id: pledges.id });
  // gifts already made to this project by the member count towards the new pledge
  if (input.memberId)
    await tx
      .update(givingTransactions)
      .set({ pledgeId: pl!.id })
      .where(
        and(
          eq(givingTransactions.campaignId, c.id),
          eq(givingTransactions.memberId, input.memberId),
          isNull(givingTransactions.pledgeId),
          confirmed,
        ),
      );
  await refreshPledgeStatus(tx, pl!.id);
  await audit(tx, ctx, {
    action: "pledge.created",
    summary: `Recorded a ${naira(input.amount)} pledge to ${c.name} from ${name}`,
    entityType: "pledge",
    entityId: pl!.id,
  });
  return pl!.id;
}

export async function cancelPledge(tx: Tx, ctx: Actor, id: string, reason: string) {
  assertCan(ctx, "giving.verify", "change pledges");
  const [pl] = await tx.select().from(pledges).where(eq(pledges.id, id));
  if (!pl) throw notFound("That pledge");
  await tx
    .update(pledges)
    .set({ status: "cancelled", note: [pl.note, `Cancelled: ${reason}`].filter(Boolean).join(" · ") })
    .where(eq(pledges.id, id));
  await audit(tx, ctx, {
    action: "pledge.cancelled",
    summary: `Cancelled ${pl.pledgerName}'s ${naira(pl.amountKobo)} pledge: ${reason}`,
    entityType: "pledge",
    entityId: id,
  });
}

/* ================= church giving settings ================= */

export type GivingSettings = {
  subaccountCode: string | null;
  bankName: string | null;
  accountName: string | null;
  accountLast4: string | null;
  receiptsForOffline: boolean;
  thankYouMessage: string | null;
};

export async function givingSettings(tx: Tx, orgId: string): Promise<GivingSettings> {
  const [o] = await tx.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
  const g = ((o?.settings ?? {}) as { giving?: Partial<GivingSettings> }).giving ?? {};
  return {
    subaccountCode: g.subaccountCode ?? null,
    bankName: g.bankName ?? null,
    accountName: g.accountName ?? null,
    accountLast4: g.accountLast4 ?? null,
    receiptsForOffline: g.receiptsForOffline ?? true,
    thankYouMessage: g.thankYouMessage ?? null,
  };
}

export async function updateGivingSettings(tx: Tx, ctx: Actor, patch: Partial<GivingSettings>) {
  assertCan(ctx, "giving.verify", "change giving settings");
  const before = await givingSettings(tx, ctx.org.id);
  const next = { ...before, ...patch };
  await tx
    .update(organisations)
    .set({ settings: sql`jsonb_set(coalesce(${organisations.settings}, '{}'::jsonb), '{giving}', ${JSON.stringify(next)}::jsonb)` })
    .where(eq(organisations.id, ctx.org.id));
  const changed = Object.keys(patch).filter(
    (k) => JSON.stringify(before[k as keyof GivingSettings]) !== JSON.stringify(next[k as keyof GivingSettings]),
  );
  if (changed.length)
    await audit(tx, ctx, {
      action: "giving.settings",
      summary: patch.subaccountCode
        ? `Set online gifts to settle into ${next.bankName} ••••${next.accountLast4} (${next.accountName})`
        : `Updated giving settings (${changed.join(", ")})`,
      entityType: "organisation",
      entityId: ctx.org.id,
    });
}

/* ================= online giving ================= */

export const onlineGiftSchema = z
  .object({
    fundId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null),
    branchId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null),
    amount: amountField.refine((k) => k >= 10_000, "The smallest online gift is ₦100."),
    coverFees: z.boolean().default(false),
    name: z.string().trim().min(2, "Enter your name.").max(120),
    email: z.string().trim().toLowerCase().email("Enter your email address. Your receipt goes there."),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || null),
    anonymous: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (!v.fundId && !v.campaignId) c.addIssue({ code: "custom", path: ["fundId"], message: "Choose what you're giving to." });
    if (v.phone && !normalizeNgPhone(v.phone)) c.addIssue({ code: "custom", path: ["phone"], message: "Enter a Nigerian number." });
    if (v.amount > 1_000_000_000) c.addIssue({ code: "custom", path: ["amount"], message: "For gifts above ₦10 million, please contact the church office." });
  });

/** For the public giving page. Runs under the church's row-level security. */
export async function givingPageData(tx: Tx, orgId: string) {
  const funds = (await listFunds(tx)).filter((f) => f.online);
  const campaigns = await listCampaigns(tx, null, { onlineOnly: true });
  const branchList = await tx
    .select({ id: branches.id, name: branches.name, level: branches.level })
    .from(branches)
    .where(isNull(branches.archivedAt))
    .orderBy(asc(branches.path));
  const settings = await givingSettings(tx, orgId);
  return { funds, campaigns, branches: branchList, settings };
}

/**
 * Starts an online gift: a pending ledger row and a payment intent. The caller then sends the giver
 * to the checkout page. Nothing counts until the provider confirms the payment.
 */
export async function createOnlineGift(tx: Tx, orgId: string, input: z.output<typeof onlineGiftSchema>) {
  const data = await givingPageData(tx, orgId);
  // live payments must settle into the church's own account, never anywhere else
  if (providerName() === "paystack" && !data.settings.subaccountCode) throw new PaymentsNotConfigured();
  let fundId = input.fundId;
  let campaignId: string | null = null;
  if (input.campaignId) {
    const c = data.campaigns.find((x) => x.id === input.campaignId);
    if (!c) throw new AppError("That project is no longer taking gifts.");
    fundId = c.fundId;
    campaignId = c.id;
  } else if (!data.funds.some((f) => f.id === fundId)) throw new AppError("That fund isn't open for online giving.");
  const hq = data.branches.find((b) => b.level === "hq") ?? data.branches[0];
  const branchId = data.branches.some((b) => b.id === input.branchId) ? input.branchId! : hq!.id;
  const phone = normalizeNgPhone(input.phone);
  // link to the giver's member record when their email or phone matches exactly one person
  const matches = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        isNull(members.deletedAt),
        or(eq(members.emailHash, blindIndex(input.email)!), phone ? eq(members.phoneHash, blindIndex(phone)!) : undefined),
      ),
    )
    .limit(2);
  const memberId = matches.length === 1 ? matches[0]!.id : null;
  const charge = input.coverFees ? grossUpLocal(input.amount) : input.amount;
  const reference = newReference();
  const [t] = await tx
    .insert(givingTransactions)
    .values({
      orgId,
      branchId,
      fundId: fundId!,
      memberId,
      donorName: input.name,
      donorEmailEnc: encrypt(input.email),
      donorPhoneEnc: encrypt(phone),
      anonymous: input.anonymous,
      amountKobo: charge,
      channel: "online",
      source: "online",
      status: "pending",
      givenOn: todayISO(),
      campaignId,
      reference,
    })
    .returning({ id: givingTransactions.id });
  await tx.insert(paymentIntents).values({
    reference,
    orgId,
    purpose: "gift",
    targetId: t!.id,
    amountKobo: charge,
    email: input.email,
    provider: providerName(),
  });
  return { reference, amountKobo: charge, subaccount: data.settings.subaccountCode };
}

/** Applies a successful payment to its pending gift. Safe to call more than once. */
export async function confirmOnlineGift(
  tx: Tx,
  orgId: string,
  txId: string,
  r: { feeKobo: number | null; channel: string | null; providerTxId: string | null; paidAt: Date | null },
) {
  const [t] = await tx.select().from(givingTransactions).where(eq(givingTransactions.id, txId)).for("update");
  if (!t || t.status === "confirmed") return { already: true };
  await tx
    .update(givingTransactions)
    .set({
      status: "confirmed",
      feeKobo: r.feeKobo ?? 0,
      gatewayChannel: r.channel,
      gatewayRef: r.providerTxId,
      confirmedAt: new Date(),
    })
    .where(eq(givingTransactions.id, txId));
  const [fresh] = await tx.select().from(givingTransactions).where(eq(givingTransactions.id, txId));
  if (fresh!.memberId) await linkPledge(tx, fresh!);
  await issueReceipt(tx, orgId, txId);
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  await audit(tx, systemActor({ id: orgId, name: o!.name }, "Online giving", []), {
    action: "giving.online_confirmed",
    summary: `Online gift ${t.reference} confirmed: ${naira(t.amountKobo)}${r.channel ? ` by ${r.channel.replace("_", " ")}` : ""}`,
    entityType: "giving_transaction",
    entityId: txId,
  });
  return { already: false };
}

export async function failOnlineGift(tx: Tx, txId: string) {
  await tx
    .update(givingTransactions)
    .set({ status: "failed" })
    .where(and(eq(givingTransactions.id, txId), eq(givingTransactions.status, "pending")));
}

/* ================= receipts ================= */

/** Gives a confirmed gift its receipt number and emails the receipt (once, however often this is called). */
export async function issueReceipt(tx: Tx, orgId: string, txId: string) {
  const [t] = await tx
    .select({ t: givingTransactions, fundName: givingFunds.name })
    .from(givingTransactions)
    .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
    .where(eq(givingTransactions.id, txId));
  if (!t || t.t.status !== "confirmed" || t.t.amountKobo <= 0) return null;
  let receiptNo = t.t.receiptNo;
  if (!receiptNo) {
    receiptNo = await nextNumber(tx, orgId, "receipt", yearOf(String(t.t.givenOn)));
    await tx.update(givingTransactions).set({ receiptNo }).where(eq(givingTransactions.id, txId));
  }
  let email = decrypt(t.t.donorEmailEnc);
  let name = t.t.donorName;
  if (t.t.memberId) {
    const [m] = await tx
      .select({ emailEnc: members.emailEnc, firstName: members.firstName, title: members.title, lastName: members.lastName })
      .from(members)
      .where(eq(members.id, t.t.memberId));
    email ??= decrypt(m?.emailEnc);
    name ??= m ? [m.title, m.firstName, m.lastName].filter(Boolean).join(" ") : null;
  }
  if (!email) return receiptNo;
  const [o] = await tx
    .select({ name: organisations.name, phone: organisations.phone })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  const settings = await givingSettings(tx, orgId);
  const rows: [string, string][] = [
    ["Receipt number", receiptNo],
    ["Amount", naira(t.t.amountKobo)],
    ["Given to", t.fundName],
    ["Date", formatDate(String(t.t.givenOn), "long")],
    ["Method", t.t.channel === "online" ? `Online${t.t.gatewayChannel ? ` (${t.t.gatewayChannel.replace("_", " ")})` : ""}` : CHANNEL_LABEL[t.t.channel]!],
    ["Reference", t.t.reference],
  ];
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 16px;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 10px 8px 0;color:#5b6884;border-bottom:1px solid #eef1f6;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eef1f6;font-weight:${k === "Amount" ? "700;font-size:18px" : "500"}">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
  const first = (name ?? "friend").replace(/^(Bro|Sis|Mr|Mrs|Dr|Pst|Deacon|Deaconess|Elder|Chief|Miss)\.?\s+/i, "").split(/\s+/)[0];
  await enqueue(
    tx,
    "email.send",
    {
      to: email,
      subject: `Receipt ${receiptNo}: ${naira(t.t.amountKobo)} to ${o!.name}`,
      html: emailLayout({
        church: o!.name,
        preheader: `Thank you for your ${t.fundName.toLowerCase()} of ${naira(t.t.amountKobo)}.`,
        heading: "Thank you for giving",
        bodyHtml:
          p(`Dear ${first},`) +
          p(settings.thankYouMessage ?? `Thank you for your gift to ${o!.name}. This is your receipt.`) +
          table +
          p(
            `Keep this email for your records.${o!.phone ? ` Questions? Call the church office on ${o!.phone.replace("+234", "0")}.` : ""}`,
          ),
        footer: `${o!.name} · Receipts are sent for every gift linked to your email address.`,
      }),
    },
    { orgId, dedupeKey: `receipt:${txId}`, maxAttempts: 8 },
  );
  await tx.update(givingTransactions).set({ receiptSentAt: new Date() }).where(eq(givingTransactions.id, txId));
  return receiptNo;
}

export const givingPageUrl = (slug: string) => `${env().APP_URL}/give/${slug}`;

/** Member search for counters entering named envelopes (they can't browse the member list). */
export async function searchGivers(tx: Tx, ctx: Actor, q: string) {
  if (!ctx.can("giving.record") && !ctx.can("giving.read_named")) assertCan(ctx, "giving.record", "record named gifts");
  const term = q.trim();
  if (term.length < 2) return [];
  const phone = normalizeNgPhone(term);
  return tx
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, memberNo: members.memberNo })
    .from(members)
    .where(
      and(
        isNull(members.deletedAt),
        branchScope(ctx, members.branchId),
        or(
          ilike(sql`${members.firstName} || ' ' || ${members.lastName}`, `%${term}%`),
          ilike(sql`${members.lastName} || ' ' || ${members.firstName}`, `%${term}%`),
          ilike(members.memberNo, `%${term}%`),
          phone ? eq(members.phoneHash, blindIndex(phone)!) : undefined,
        ),
      ),
    )
    .orderBy(asc(members.firstName))
    .limit(8);
}
