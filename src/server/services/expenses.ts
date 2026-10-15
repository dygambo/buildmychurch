import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db";
import {
  assets,
  branches,
  budgetLines,
  expenseCategories,
  expenses,
  files,
  givingFunds,
  givingTransactions,
  memberships,
  organisations,
  remittances,
  roles,
  users,
  ASSET_CATEGORIES,
  EXPENSE_METHODS,
} from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, p } from "../emails/layout";
import { env } from "../env";
import { formatDate, naira, todayISO } from "@/lib/format";
import { assertBranch, branchScope } from "./scope";

/* ================= shared ================= */

const toKobo = (v: unknown) => Math.round(Number(String(v ?? "").replace(/[₦,\s]/g, "")) * 100);

const money = (opts: { min?: number; allowZero?: boolean } = {}) =>
  z.union([z.string(), z.number()]).transform((v, c) => {
    const k = toKobo(v);
    if (!Number.isFinite(k) || k < 0 || (!opts.allowZero && k === 0)) {
      c.addIssue({ code: "custom", message: opts.allowZero ? "Enter zero or more." : "Enter an amount above zero." });
      return z.NEVER;
    }
    if (k > 100_000_000_000) {
      c.addIssue({ code: "custom", message: "That amount is too large. Check the number of zeros." });
      return z.NEVER;
    }
    return k;
  });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const optUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null);
const isoDate = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

async function nextNo(tx: Tx, orgId: string, kind: "expense" | "asset", year: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`finance_no:${kind}:${orgId}`}))`);
  const prefix = kind === "expense" ? `E-${year}-` : "A-";
  const col = kind === "expense" ? expenses.expenseNo : assets.assetNo;
  const table = kind === "expense" ? expenses : assets;
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(substring(${col} from '\\d+$')::int), 0)` })
    .from(table)
    .where(ilike(col, `${prefix}%`));
  return `${prefix}${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
}

export const METHOD_LABEL: Record<(typeof EXPENSE_METHODS)[number], string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  cheque: "Cheque",
  pos: "POS / card",
  other: "Other",
};

/** Staff with a permission, for notifications. Branch staff only hear about their own branches. */
async function staffWith(tx: Tx, orgId: string, perm: string, branchId?: string) {
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email, branchIds: memberships.branchIds })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.status, "active"),
        sql`${perm} = any(${roles.permissions})`,
      ),
    );
  return rows.filter((r) => !branchId || !r.branchIds.length || r.branchIds.includes(branchId));
}

async function orgName(tx: Tx, orgId: string) {
  const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
  return o?.name ?? "Your church";
}

/* ================= settings ================= */

export type FinanceSettings = {
  /** Expenses at or below this approve themselves when submitted. 0 means everything needs approval. */
  approvalThresholdKobo: number;
  /** Share of a branch's income sent to headquarters, in basis points (1000 = 10%). 0 turns remittances off. */
  remittanceBps: number;
  /** Which income counts towards the remittance. */
  remittanceBasis: "unrestricted" | "all";
  /** Money already held in each fund on `openingDate`, so balances start from the truth. */
  openingBalances: Record<string, number>;
  openingDate: string | null;
};

export async function financeSettings(tx: Tx, orgId: string): Promise<FinanceSettings> {
  const [o] = await tx.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
  const f = ((o?.settings ?? {}) as { finance?: Partial<FinanceSettings> }).finance ?? {};
  return {
    approvalThresholdKobo: f.approvalThresholdKobo ?? 5_000_000,
    remittanceBps: f.remittanceBps ?? 1000,
    remittanceBasis: f.remittanceBasis ?? "unrestricted",
    openingBalances: f.openingBalances ?? {},
    openingDate: f.openingDate ?? null,
  };
}

export const financeSettingsSchema = z.object({
  approvalThreshold: money({ allowZero: true }),
  remittancePercent: z.coerce
    .number({ message: "Enter a percentage." })
    .min(0, "Enter 0 or more.")
    .max(100, "Enter 100 or less."),
  remittanceBasis: z.enum(["unrestricted", "all"]),
});

export async function updateFinanceSettings(
  tx: Tx,
  ctx: Actor,
  input: Partial<FinanceSettings>,
  summary = "Updated finance settings",
) {
  assertCan(ctx, "finance.approve", "change finance settings");
  const before = await financeSettings(tx, ctx.org.id);
  const next = { ...before, ...input };
  await tx
    .update(organisations)
    .set({
      settings: sql`jsonb_set(coalesce(${organisations.settings}, '{}'::jsonb), '{finance}', ${JSON.stringify(next)}::jsonb)`,
    })
    .where(eq(organisations.id, ctx.org.id));
  await audit(tx, ctx, { action: "finance.settings", summary, entityType: "organisation", entityId: ctx.org.id, before, after: next });
  return next;
}

export async function saveApprovalRules(tx: Tx, ctx: Actor, input: z.output<typeof financeSettingsSchema>) {
  return updateFinanceSettings(
    tx,
    ctx,
    {
      approvalThresholdKobo: input.approvalThreshold,
      remittanceBps: Math.round(input.remittancePercent * 100),
      remittanceBasis: input.remittanceBasis,
    },
    `Set expenses up to ${naira(input.approvalThreshold)} to approve themselves; branches remit ${input.remittancePercent}% of ${input.remittanceBasis === "all" ? "all" : "general"} income`,
  );
}

export const openingBalancesSchema = z.object({
  openingDate: isoDate("Choose the date these balances were true."),
  balances: z.record(z.string().uuid(), money({ allowZero: true })),
});

export async function saveOpeningBalances(tx: Tx, ctx: Actor, input: z.output<typeof openingBalancesSchema>) {
  if (input.openingDate > todayISO()) throw new AppError("That date is in the future.", { openingDate: "Choose today or earlier." });
  return updateFinanceSettings(
    tx,
    ctx,
    { openingBalances: input.balances, openingDate: input.openingDate },
    `Set opening fund balances as at ${formatDate(input.openingDate)} (${naira(Object.values(input.balances).reduce((s, v) => s + v, 0))} in all)`,
  );
}

/* ================= categories ================= */

export const DEFAULT_CATEGORIES = [
  { name: "Salaries & allowances", code: "SALARY", color: "c1" },
  { name: "Utilities, fuel & diesel", code: "UTIL", color: "c4" },
  { name: "Rent, repairs & maintenance", code: "MAINT", color: "c5" },
  { name: "Ministry & programmes", code: "MINISTRY", color: "c3" },
  { name: "Welfare & benevolence", code: "WELFARE", color: "c2" },
  { name: "Outreach & missions", code: "OUTREACH", color: "c6" },
  { name: "Equipment & instruments", code: "EQUIP", color: "c1" },
  { name: "Office & administration", code: "ADMIN", color: "c4" },
  { name: "Building project", code: "BUILD", color: "c5" },
] as const;

export async function createDefaultCategories(tx: Tx, orgId: string) {
  await tx
    .insert(expenseCategories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, orgId, sortOrder: i + 1 })))
    .onConflictDoNothing();
}

export async function listCategories(tx: Tx, opts: { includeArchived?: boolean } = {}) {
  return tx
    .select()
    .from(expenseCategories)
    .where(opts.includeArchived ? undefined : isNull(expenseCategories.archivedAt))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));
}

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Enter a name.").max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,12}$/, "Use 2–12 letters or numbers, e.g. FUEL."),
  description: optText(200),
  color: z.enum(["c1", "c2", "c3", "c4", "c5", "c6"]).default("c1"),
});

export async function saveCategory(tx: Tx, ctx: Actor, input: z.output<typeof categorySchema>) {
  assertCan(ctx, "finance.approve", "manage expense categories");
  const [clash] = await tx
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.code, input.code), input.id ? ne(expenseCategories.id, input.id) : undefined));
  if (clash) throw new AppError("Another category already uses that code.", { code: "Choose a different code." });
  const values = { name: input.name, code: input.code, description: input.description, color: input.color };
  let id = input.id;
  if (id) {
    const r = await tx.update(expenseCategories).set(values).where(eq(expenseCategories.id, id)).returning({ id: expenseCategories.id });
    if (!r.length) throw notFound("That category");
  } else {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(expenseCategories)) as [{ n: number }];
    const [r] = await tx
      .insert(expenseCategories)
      .values({ ...values, orgId: ctx.org.id, sortOrder: n + 1 })
      .returning({ id: expenseCategories.id });
    id = r!.id;
  }
  await audit(tx, ctx, {
    action: input.id ? "expense_category.updated" : "expense_category.created",
    summary: `${input.id ? "Updated" : "Added"} expense category ${input.name}`,
    entityType: "expense_category",
    entityId: id,
  });
  return id;
}

export async function setCategoryArchived(tx: Tx, ctx: Actor, id: string, archived: boolean) {
  assertCan(ctx, "finance.approve", "manage expense categories");
  const [c] = await tx
    .update(expenseCategories)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(expenseCategories.id, id))
    .returning();
  if (!c) throw notFound("That category");
  await audit(tx, ctx, {
    action: archived ? "expense_category.archived" : "expense_category.restored",
    summary: `${archived ? "Closed" : "Reopened"} expense category ${c.name}`,
    entityType: "expense_category",
    entityId: id,
  });
}

/* ================= expenses ================= */

export const EXPENSE_STATUS_LABEL = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved, not paid",
  rejected: "Sent back",
  paid: "Paid",
  void: "Voided",
} as const;

export const expenseSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().uuid("Choose a branch."),
  categoryId: z.string().uuid("Choose a category."),
  fundId: optUuid,
  payee: z.string().trim().min(2, "Who was paid?").max(120),
  description: z.string().trim().min(3, "Say what it was for.").max(500),
  amount: money(),
  spentOn: isoDate("Choose the date."),
  method: z.enum(EXPENSE_METHODS),
  paymentRef: optText(80),
  note: optText(1000),
});

async function loadExpense(tx: Tx, ctx: Actor, id: string) {
  const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
  if (!e) throw notFound("That expense");
  assertBranch(ctx, e.branchId);
  return e;
}

async function checkFundAndCategory(tx: Tx, input: { categoryId: string; fundId: string | null }) {
  const [c] = await tx
    .select({ id: expenseCategories.id, archivedAt: expenseCategories.archivedAt })
    .from(expenseCategories)
    .where(eq(expenseCategories.id, input.categoryId));
  if (!c) throw new AppError("That category no longer exists.", { categoryId: "Choose another category." });
  if (c.archivedAt) throw new AppError("That category is closed.", { categoryId: "Choose another category." });
  if (input.fundId) {
    const [f] = await tx.select({ id: givingFunds.id }).from(givingFunds).where(eq(givingFunds.id, input.fundId));
    if (!f) throw new AppError("That fund no longer exists.", { fundId: "Choose another fund." });
  }
}

/** Creates or edits an expense. Only drafts and sent-back expenses can change, and only by whoever raised them. */
export async function saveExpense(tx: Tx, ctx: Actor, input: z.output<typeof expenseSchema>) {
  assertCan(ctx, "finance.expenses", "record expenses");
  assertBranch(ctx, input.branchId);
  if (input.spentOn > todayISO()) throw new AppError("That date is in the future.", { spentOn: "Choose today or earlier." });
  await checkFundAndCategory(tx, input);
  const values = {
    branchId: input.branchId,
    categoryId: input.categoryId,
    fundId: input.fundId,
    payee: input.payee,
    description: input.description,
    amountKobo: input.amount,
    spentOn: input.spentOn,
    method: input.method,
    paymentRef: input.paymentRef,
    note: input.note,
  };
  if (input.id) {
    const e = await loadExpense(tx, ctx, input.id);
    if (e.status !== "draft" && e.status !== "rejected")
      throw new AppError("Only drafts and sent-back expenses can be edited.");
    if (e.requestedBy !== ctx.user.id) throw new AppError(`${e.requestedByName} raised this expense, so only they can edit it.`);
    await tx.update(expenses).set({ ...values, status: "draft" }).where(eq(expenses.id, e.id));
    await audit(tx, ctx, {
      action: "expense.updated",
      summary: `Edited expense ${e.expenseNo}: ${input.payee}, ${naira(input.amount)}`,
      entityType: "expense",
      entityId: e.id,
    });
    return e.id;
  }
  const expenseNo = await nextNo(tx, ctx.org.id, "expense", Number(input.spentOn.slice(0, 4)));
  const [e] = await tx
    .insert(expenses)
    .values({ ...values, orgId: ctx.org.id, expenseNo, requestedBy: ctx.user.id, requestedByName: ctx.user.name })
    .returning({ id: expenses.id });
  await audit(tx, ctx, {
    action: "expense.created",
    summary: `Recorded expense ${expenseNo}: ${input.payee}, ${naira(input.amount)}`,
    entityType: "expense",
    entityId: e!.id,
  });
  return e!.id;
}

/**
 * Sends an expense for approval. At or under the church's threshold it approves itself (and the audit log says so);
 * above it, people who can approve are emailed.
 */
export async function submitExpense(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "finance.expenses", "submit expenses");
  const e = await loadExpense(tx, ctx, id);
  if (e.status !== "draft" && e.status !== "rejected") throw new AppError("This expense has already been submitted.");
  if (e.requestedBy !== ctx.user.id) throw new AppError(`${e.requestedByName} raised this expense, so only they can submit it.`);
  const s = await financeSettings(tx, ctx.org.id);
  const now = new Date();
  if (e.amountKobo <= s.approvalThresholdKobo) {
    await tx
      .update(expenses)
      .set({
        status: "approved",
        submittedAt: now,
        autoApproved: true,
        approvedBy: ctx.user.id,
        approvedByName: ctx.user.name,
        approvedAt: now,
        rejectionNote: null,
      })
      .where(eq(expenses.id, id));
    await audit(tx, ctx, {
      action: "expense.auto_approved",
      summary: `Expense ${e.expenseNo} (${naira(e.amountKobo)}) approved itself: it is within the ${naira(s.approvalThresholdKobo)} limit`,
      entityType: "expense",
      entityId: id,
    });
    return { status: "approved" as const };
  }
  await tx
    .update(expenses)
    .set({ status: "submitted", submittedAt: now, rejectionNote: null })
    .where(eq(expenses.id, id));
  await audit(tx, ctx, {
    action: "expense.submitted",
    summary: `Sent expense ${e.expenseNo} (${naira(e.amountKobo)}, ${e.payee}) for approval`,
    entityType: "expense",
    entityId: id,
  });
  const church = await orgName(tx, ctx.org.id);
  const approvers = (await staffWith(tx, ctx.org.id, "finance.approve", e.branchId)).filter((a) => a.id !== ctx.user.id);
  for (const a of approvers)
    await enqueue(
      tx,
      "email.send",
      {
        to: a.email,
        subject: `Approve ${naira(e.amountKobo)} to ${e.payee}?`,
        html: emailLayout({
          church,
          preheader: `${ctx.user.name} needs approval for expense ${e.expenseNo}.`,
          heading: "An expense needs your approval",
          bodyHtml:
            p(`${ctx.user.name} raised expense ${e.expenseNo}: ${naira(e.amountKobo)} to ${e.payee} for ${e.description}.`) +
            p("It is above the amount that approves itself, so someone other than the person who raised it must approve it."),
          button: { label: "Review the expense", url: `${env().APP_URL}/expenses/${id}` },
        }),
      },
      { orgId: ctx.org.id, dedupeKey: `expense-approve:${id}:${a.id}:${now.getTime()}` },
    );
  return { status: "submitted" as const };
}

export async function approveExpense(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "finance.approve", "approve expenses");
  const e = await loadExpense(tx, ctx, id);
  if (e.status !== "submitted") throw new AppError("Only expenses waiting for approval can be approved.");
  if (e.requestedBy === ctx.user.id)
    throw new AppError("You raised this expense, so someone else must approve it. That's the two-person rule.");
  await tx
    .update(expenses)
    .set({ status: "approved", approvedBy: ctx.user.id, approvedByName: ctx.user.name, approvedAt: new Date() })
    .where(eq(expenses.id, id));
  await audit(tx, ctx, {
    action: "expense.approved",
    summary: `Approved expense ${e.expenseNo}: ${naira(e.amountKobo)} to ${e.payee}`,
    entityType: "expense",
    entityId: id,
  });
  await notifyRequester(tx, ctx, e, "approved");
}

export const rejectSchema = z.object({ id: z.string().uuid(), note: z.string().trim().min(3, "Say what needs fixing.").max(500) });

export async function rejectExpense(tx: Tx, ctx: Actor, input: z.output<typeof rejectSchema>) {
  assertCan(ctx, "finance.approve", "send expenses back");
  const e = await loadExpense(tx, ctx, input.id);
  if (e.status !== "submitted" && e.status !== "approved")
    throw new AppError("Only expenses waiting for approval or payment can be sent back.");
  await tx
    .update(expenses)
    .set({ status: "rejected", rejectionNote: input.note, approvedBy: null, approvedByName: null, approvedAt: null, autoApproved: false })
    .where(eq(expenses.id, e.id));
  await audit(tx, ctx, {
    action: "expense.rejected",
    summary: `Sent expense ${e.expenseNo} back: ${input.note}`,
    entityType: "expense",
    entityId: e.id,
  });
  await notifyRequester(tx, ctx, e, "rejected", input.note);
}

async function notifyRequester(
  tx: Tx,
  ctx: Actor,
  e: typeof expenses.$inferSelect,
  what: "approved" | "rejected",
  note?: string,
) {
  if (e.requestedBy === ctx.user.id) return;
  const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, e.requestedBy));
  if (!u) return;
  await enqueue(
    tx,
    "email.send",
    {
      to: u.email,
      subject: what === "approved" ? `Approved: ${e.expenseNo} (${naira(e.amountKobo)})` : `Sent back: ${e.expenseNo}`,
      html: emailLayout({
        church: await orgName(tx, ctx.org.id),
        heading: what === "approved" ? "Your expense was approved" : "Your expense needs changes",
        bodyHtml:
          p(
            what === "approved"
              ? `${ctx.user.name} approved ${e.expenseNo}: ${naira(e.amountKobo)} to ${e.payee}. It can now be paid.`
              : `${ctx.user.name} sent ${e.expenseNo} (${naira(e.amountKobo)} to ${e.payee}) back.`,
          ) + (note ? p(`What needs fixing: ${note}`) : ""),
        button: { label: "Open the expense", url: `${env().APP_URL}/expenses/${e.id}` },
      }),
    },
    { orgId: ctx.org.id, dedupeKey: `expense-${what}:${e.id}:${Date.now()}` },
  );
}

export const paySchema = z.object({
  id: z.string().uuid(),
  method: z.enum(EXPENSE_METHODS),
  paymentRef: optText(80),
});

export async function markExpensePaid(tx: Tx, ctx: Actor, input: z.output<typeof paySchema>) {
  assertCan(ctx, "finance.expenses", "record payments");
  const e = await loadExpense(tx, ctx, input.id);
  if (e.status !== "approved") throw new AppError("Only approved expenses can be marked paid.");
  if (input.method !== "cash" && !input.paymentRef && !e.paymentRef)
    throw new AppError("Add the transfer or cheque reference.", { paymentRef: "Enter the reference from the bank." });
  await tx
    .update(expenses)
    .set({
      status: "paid",
      method: input.method,
      paymentRef: input.paymentRef ?? e.paymentRef,
      paidBy: ctx.user.id,
      paidByName: ctx.user.name,
      paidAt: new Date(),
    })
    .where(eq(expenses.id, e.id));
  await audit(tx, ctx, {
    action: "expense.paid",
    summary: `Paid expense ${e.expenseNo}: ${naira(e.amountKobo)} to ${e.payee} by ${METHOD_LABEL[input.method].toLowerCase()}`,
    entityType: "expense",
    entityId: e.id,
  });
}

export const voidSchema = z.object({ id: z.string().uuid(), reason: z.string().trim().min(5, "Say why it's being voided.").max(500) });

export async function voidExpense(tx: Tx, ctx: Actor, input: z.output<typeof voidSchema>) {
  assertCan(ctx, "finance.approve", "void expenses");
  const e = await loadExpense(tx, ctx, input.id);
  if (e.status === "void") throw new AppError("This expense is already voided.");
  if (e.status === "draft" || e.status === "rejected") throw new AppError("Delete drafts instead of voiding them.");
  await tx
    .update(expenses)
    .set({ status: "void", voidedBy: ctx.user.id, voidReason: input.reason, voidedAt: new Date() })
    .where(eq(expenses.id, e.id));
  await audit(tx, ctx, {
    action: "expense.voided",
    summary: `Voided expense ${e.expenseNo} (${naira(e.amountKobo)} to ${e.payee}): ${input.reason}`,
    entityType: "expense",
    entityId: e.id,
  });
}

export async function deleteExpense(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "finance.expenses", "delete expenses");
  const e = await loadExpense(tx, ctx, id);
  if (e.status !== "draft" && e.status !== "rejected") throw new AppError("Only drafts can be deleted. Void it instead.");
  if (e.requestedBy !== ctx.user.id) throw new AppError(`${e.requestedByName} raised this expense, so only they can delete it.`);
  await tx.update(files).set({ deletedAt: new Date() }).where(and(eq(files.entityType, "expense"), eq(files.entityId, id)));
  await tx.delete(expenses).where(eq(expenses.id, id));
  await audit(tx, ctx, {
    action: "expense.deleted",
    summary: `Deleted draft expense ${e.expenseNo} (${naira(e.amountKobo)} to ${e.payee})`,
    entityType: "expense",
    entityId: id,
  });
}

export type ExpenseFilters = {
  status?: string;
  categoryId?: string;
  branchId?: string;
  fundId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
};

function expenseWhere(ctx: Actor, f: ExpenseFilters): SQL | undefined {
  const q = f.q?.trim();
  return and(
    branchScope(ctx, expenses.branchId),
    f.status === "open"
      ? inArray(expenses.status, ["submitted", "approved"])
      : f.status && f.status in EXPENSE_STATUS_LABEL
        ? eq(expenses.status, f.status as keyof typeof EXPENSE_STATUS_LABEL)
        : undefined,
    f.categoryId ? eq(expenses.categoryId, f.categoryId) : undefined,
    f.branchId ? eq(expenses.branchId, f.branchId) : undefined,
    f.fundId ? eq(expenses.fundId, f.fundId) : undefined,
    f.from ? gte(expenses.spentOn, f.from) : undefined,
    f.to ? lte(expenses.spentOn, f.to) : undefined,
    q
      ? or(
          ilike(expenses.payee, `%${q}%`),
          ilike(expenses.description, `%${q}%`),
          ilike(expenses.expenseNo, `%${q}%`),
          ilike(expenses.paymentRef, `%${q}%`),
        )
      : undefined,
  );
}

const PAGE = 30;

export async function listExpenses(tx: Tx, ctx: Actor, f: ExpenseFilters) {
  assertCan(ctx, "finance.expenses", "see expenses");
  const where = expenseWhere(ctx, f);
  const page = Math.max(1, f.page ?? 1);
  const rows = await tx
    .select({
      id: expenses.id,
      expenseNo: expenses.expenseNo,
      payee: expenses.payee,
      description: expenses.description,
      amountKobo: expenses.amountKobo,
      spentOn: expenses.spentOn,
      status: expenses.status,
      method: expenses.method,
      requestedBy: expenses.requestedBy,
      requestedByName: expenses.requestedByName,
      autoApproved: expenses.autoApproved,
      categoryName: expenseCategories.name,
      categoryColor: expenseCategories.color,
      branchName: branches.name,
      fundName: givingFunds.name,
      files: sql<number>`(select count(*)::int from files f where f.entity_type = 'expense' and f.entity_id = expenses.id and f.deleted_at is null)`,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(branches, eq(branches.id, expenses.branchId))
    .leftJoin(givingFunds, eq(givingFunds.id, expenses.fundId))
    .where(where)
    .orderBy(desc(expenses.spentOn), desc(expenses.createdAt))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  const [t] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${expenses.amountKobo}) filter (where ${expenses.status} <> 'void'), 0)::bigint`,
    })
    .from(expenses)
    .where(where);
  return {
    rows: rows.map((r) => ({ ...r, spentOn: String(r.spentOn), amountKobo: Number(r.amountKobo) })),
    total: Number(t?.n ?? 0),
    sumKobo: Number(t?.total ?? 0),
    page,
    pageSize: PAGE,
  };
}
export type ExpenseRow = Awaited<ReturnType<typeof listExpenses>>["rows"][number];

export async function exportExpenses(tx: Tx, ctx: Actor, f: ExpenseFilters) {
  assertCan(ctx, "finance.expenses", "export expenses");
  const rows = await tx
    .select({
      e: expenses,
      categoryName: expenseCategories.name,
      branchName: branches.name,
      fundName: givingFunds.name,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(branches, eq(branches.id, expenses.branchId))
    .leftJoin(givingFunds, eq(givingFunds.id, expenses.fundId))
    .where(expenseWhere(ctx, f))
    .orderBy(asc(expenses.spentOn), asc(expenses.expenseNo))
    .limit(50_000);
  await audit(tx, ctx, {
    action: "expense.exported",
    summary: `Exported ${rows.length} expense${rows.length === 1 ? "" : "s"}`,
    entityType: "expense",
  });
  return rows.map((r) => ({
    Number: r.e.expenseNo,
    Date: String(r.e.spentOn),
    Branch: r.branchName,
    Category: r.categoryName,
    Fund: r.fundName ?? "",
    Payee: r.e.payee,
    Description: r.e.description,
    "Amount (₦)": Number(r.e.amountKobo) / 100,
    Method: METHOD_LABEL[r.e.method],
    Reference: r.e.paymentRef ?? "",
    Status: EXPENSE_STATUS_LABEL[r.e.status],
    "Raised by": r.e.requestedByName,
    "Approved by": r.e.autoApproved ? "Within the approval limit" : (r.e.approvedByName ?? ""),
    "Paid by": r.e.paidByName ?? "",
  }));
}

export async function getExpense(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "finance.expenses", "see expenses");
  const [r] = await tx
    .select({
      e: expenses,
      categoryName: expenseCategories.name,
      branchName: branches.name,
      fundName: givingFunds.name,
      fundRestricted: givingFunds.restricted,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(branches, eq(branches.id, expenses.branchId))
    .leftJoin(givingFunds, eq(givingFunds.id, expenses.fundId))
    .where(eq(expenses.id, id));
  if (!r) throw notFound("That expense");
  assertBranch(ctx, r.e.branchId);
  const s = await financeSettings(tx, ctx.org.id);
  const isRequester = r.e.requestedBy === ctx.user.id;
  const [voider] = r.e.voidedBy
    ? await tx.select({ name: users.name }).from(users).where(eq(users.id, r.e.voidedBy))
    : [];
  const fundBalance = r.e.fundId ? (await fundBalances(tx, ctx)).find((f) => f.id === r.e.fundId) : undefined;
  return {
    ...r.e,
    amountKobo: Number(r.e.amountKobo),
    spentOn: String(r.e.spentOn),
    categoryName: r.categoryName,
    branchName: r.branchName,
    fundName: r.fundName,
    fundRestricted: !!r.fundRestricted,
    fundBalanceKobo: fundBalance?.balance ?? null,
    voidedByName: voider?.name ?? null,
    thresholdKobo: s.approvalThresholdKobo,
    isRequester,
    canEdit: isRequester && (r.e.status === "draft" || r.e.status === "rejected"),
    canApprove: ctx.can("finance.approve") && r.e.status === "submitted" && !isRequester,
    canReject: ctx.can("finance.approve") && (r.e.status === "submitted" || r.e.status === "approved"),
    canPay: r.e.status === "approved",
    canVoid: ctx.can("finance.approve") && ["submitted", "approved", "paid"].includes(r.e.status),
  };
}

export async function pendingApprovalCount(tx: Tx, ctx: Actor) {
  if (!ctx.can("finance.approve")) return 0;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(expenses)
    .where(and(eq(expenses.status, "submitted"), ne(expenses.requestedBy, ctx.user.id), branchScope(ctx, expenses.branchId)));
  return Number(r?.n ?? 0);
}

/* ================= accounts: income, spending and fund balances ================= */

/** Income is confirmed giving (reversals included as negatives); spending is paid expenses. */
export async function accountsOverview(tx: Tx, ctx: Actor, year: number) {
  assertCan(ctx, "finance.expenses", "see the accounts");
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const income = await tx
    .select({
      month: sql<string>`to_char(${givingTransactions.givenOn}, 'YYYY-MM')`,
      fundId: givingTransactions.fundId,
      amount: sql<number>`sum(${givingTransactions.amountKobo})::bigint`,
      fees: sql<number>`sum(${givingTransactions.feeKobo})::bigint`,
    })
    .from(givingTransactions)
    .where(
      and(
        eq(givingTransactions.status, "confirmed"),
        gte(givingTransactions.givenOn, from),
        lte(givingTransactions.givenOn, to),
        branchScope(ctx, givingTransactions.branchId),
      ),
    )
    .groupBy(sql`1`, givingTransactions.fundId);
  const spend = await tx
    .select({
      month: sql<string>`to_char(${expenses.spentOn}, 'YYYY-MM')`,
      categoryId: expenses.categoryId,
      amount: sql<number>`sum(${expenses.amountKobo})::bigint`,
    })
    .from(expenses)
    .where(
      and(eq(expenses.status, "paid"), gte(expenses.spentOn, from), lte(expenses.spentOn, to), branchScope(ctx, expenses.branchId)),
    )
    .groupBy(sql`1`, expenses.categoryId);
  const cats = await listCategories(tx, { includeArchived: true });
  const budgets = await tx
    .select({ categoryId: budgetLines.categoryId, amount: sql<number>`sum(${budgetLines.amountKobo})::bigint` })
    .from(budgetLines)
    .where(and(eq(budgetLines.year, year), branchScope(ctx, budgetLines.branchId)))
    .groupBy(budgetLines.categoryId);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const monthly = months.map((m) => ({
    month: m,
    income: income.filter((r) => r.month === m).reduce((s, r) => s + Number(r.amount), 0),
    fees: income.filter((r) => r.month === m).reduce((s, r) => s + Number(r.fees), 0),
    spending: spend.filter((r) => r.month === m).reduce((s, r) => s + Number(r.amount), 0),
  }));
  const thisMonth = todayISO().slice(0, 7);
  const elapsed = year < Number(thisMonth.slice(0, 4)) ? 12 : year > Number(thisMonth.slice(0, 4)) ? 0 : Number(thisMonth.slice(5, 7));
  const byCategory = cats
    .map((c) => {
      const actual = spend.filter((r) => r.categoryId === c.id).reduce((s, r) => s + Number(r.amount), 0);
      const budget = Number(budgets.find((b) => b.categoryId === c.id)?.amount ?? 0);
      return { id: c.id, name: c.name, color: c.color, actual, budget, budgetToDate: Math.round((budget * elapsed) / 12) };
    })
    .filter((c) => c.actual || c.budget)
    .sort((a, b) => b.actual - a.actual);
  const [open] = await tx
    .select({
      submitted: sql<number>`count(*) filter (where ${expenses.status} = 'submitted')::int`,
      approved: sql<number>`count(*) filter (where ${expenses.status} = 'approved')::int`,
      approvedKobo: sql<number>`coalesce(sum(${expenses.amountKobo}) filter (where ${expenses.status} = 'approved'), 0)::bigint`,
    })
    .from(expenses)
    .where(branchScope(ctx, expenses.branchId));
  const totals = monthly.reduce(
    (s, m) => ({ income: s.income + m.income, spending: s.spending + m.spending, fees: s.fees + m.fees }),
    { income: 0, spending: 0, fees: 0 },
  );
  return {
    year,
    monthly,
    byCategory,
    totals,
    budgetTotal: byCategory.reduce((s, c) => s + c.budget, 0),
    funds: await fundBalances(tx, ctx),
    awaitingApproval: Number(open?.submitted ?? 0),
    awaitingPayment: Number(open?.approved ?? 0),
    awaitingPaymentKobo: Number(open?.approvedKobo ?? 0),
    thisMonth: monthly.find((m) => m.month === thisMonth) ?? null,
  };
}

/**
 * What each fund holds: the opening balance, plus confirmed gifts since then, less paid expenses charged to it.
 * Payment-provider fees come off online gifts before the money lands, so they're deducted too.
 */
export async function fundBalances(tx: Tx, ctx: Actor) {
  const s = await financeSettings(tx, ctx.org.id);
  const since = s.openingDate ?? "1900-01-01";
  const funds = await tx.select().from(givingFunds).orderBy(asc(givingFunds.sortOrder));
  const gifts = await tx
    .select({
      fundId: givingTransactions.fundId,
      amount: sql<number>`sum(${givingTransactions.amountKobo} - ${givingTransactions.feeKobo})::bigint`,
    })
    .from(givingTransactions)
    .where(
      and(
        eq(givingTransactions.status, "confirmed"),
        s.openingDate ? sql`${givingTransactions.givenOn} > ${since}` : undefined,
        branchScope(ctx, givingTransactions.branchId),
      ),
    )
    .groupBy(givingTransactions.fundId);
  const spent = await tx
    .select({ fundId: expenses.fundId, amount: sql<number>`sum(${expenses.amountKobo})::bigint` })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, "paid"),
        s.openingDate ? sql`${expenses.spentOn} > ${since}` : undefined,
        branchScope(ctx, expenses.branchId),
      ),
    )
    .groupBy(expenses.fundId);
  const unassigned = Number(spent.find((x) => x.fundId === null)?.amount ?? 0);
  const rows = funds
    .filter((f) => !f.archivedAt || gifts.some((g) => g.fundId === f.id))
    .map((f) => {
      const opening = ctx.branchIds.length ? 0 : (s.openingBalances[f.id] ?? 0);
      const inflow = Number(gifts.find((g) => g.fundId === f.id)?.amount ?? 0);
      const outflow = Number(spent.find((x) => x.fundId === f.id)?.amount ?? 0);
      return {
        id: f.id,
        name: f.name,
        color: f.color,
        restricted: f.restricted,
        opening,
        inflow,
        outflow,
        balance: opening + inflow - outflow,
      };
    });
  return Object.assign(rows, { unassignedSpendKobo: unassigned, openingDate: s.openingDate });
}

/* ================= budgets ================= */

export async function getBudget(tx: Tx, ctx: Actor, year: number, branchId: string) {
  assertCan(ctx, "finance.expenses", "see budgets");
  assertBranch(ctx, branchId);
  const cats = await listCategories(tx);
  const lines = await tx
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.year, year), eq(budgetLines.branchId, branchId)));
  const actual = await tx
    .select({ categoryId: expenses.categoryId, amount: sql<number>`sum(${expenses.amountKobo})::bigint` })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, "paid"),
        eq(expenses.branchId, branchId),
        gte(expenses.spentOn, `${year}-01-01`),
        lte(expenses.spentOn, `${year}-12-31`),
      ),
    )
    .groupBy(expenses.categoryId);
  const prev = await tx
    .select({ categoryId: expenses.categoryId, amount: sql<number>`sum(${expenses.amountKobo})::bigint` })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, "paid"),
        eq(expenses.branchId, branchId),
        gte(expenses.spentOn, `${year - 1}-01-01`),
        lte(expenses.spentOn, `${year - 1}-12-31`),
      ),
    )
    .groupBy(expenses.categoryId);
  return cats.map((c) => ({
    categoryId: c.id,
    name: c.name,
    color: c.color,
    budget: Number(lines.find((l) => l.categoryId === c.id)?.amountKobo ?? 0),
    actual: Number(actual.find((a) => a.categoryId === c.id)?.amount ?? 0),
    lastYear: Number(prev.find((a) => a.categoryId === c.id)?.amount ?? 0),
  }));
}

export const budgetSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  branchId: z.string().uuid(),
  lines: z.array(z.object({ categoryId: z.string().uuid(), amount: money({ allowZero: true }) })).max(200),
});

export async function saveBudget(tx: Tx, ctx: Actor, input: z.output<typeof budgetSchema>) {
  assertCan(ctx, "finance.expenses", "set budgets");
  assertBranch(ctx, input.branchId);
  const [b] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, input.branchId));
  if (!b) throw notFound("That branch");
  const before = await tx
    .select({ categoryId: budgetLines.categoryId, amount: budgetLines.amountKobo })
    .from(budgetLines)
    .where(and(eq(budgetLines.year, input.year), eq(budgetLines.branchId, input.branchId)));
  for (const l of input.lines) {
    await tx
      .insert(budgetLines)
      .values({
        orgId: ctx.org.id,
        year: input.year,
        branchId: input.branchId,
        categoryId: l.categoryId,
        amountKobo: l.amount,
        updatedBy: ctx.user.id,
      })
      .onConflictDoUpdate({
        target: [budgetLines.orgId, budgetLines.year, budgetLines.branchId, budgetLines.categoryId],
        set: { amountKobo: l.amount, updatedBy: ctx.user.id, updatedAt: new Date() },
      });
  }
  const total = input.lines.reduce((s, l) => s + l.amount, 0);
  await audit(tx, ctx, {
    action: "budget.saved",
    summary: `Set the ${input.year} budget for ${b.name} to ${naira(total)}`,
    entityType: "budget",
    entityId: input.branchId,
    before: Object.fromEntries(before.map((x) => [x.categoryId, Number(x.amount)])),
    after: Object.fromEntries(input.lines.map((x) => [x.categoryId, x.amount])),
  });
  return total;
}

/* ================= branch remittances ================= */

const periodRange = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
};

export const previousPeriod = (iso = todayISO()) => {
  const [y, m] = iso.slice(0, 7).split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * Works out what each branch owes headquarters for a month. Safe to run again: amounts update until a branch
 * records its payment, and are left alone after that.
 */
export async function calculateRemittances(tx: Tx, orgId: string, period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError("Choose a month.");
  if (period >= todayISO().slice(0, 7)) throw new AppError("Remittances are worked out once the month has ended.");
  const s = await financeSettings(tx, orgId);
  if (!s.remittanceBps) return { created: 0, updated: 0 };
  const { from, to } = periodRange(period);
  const list = await tx.select().from(branches).where(isNull(branches.archivedAt));
  const hq = list.find((b) => b.level === "hq");
  const income = await tx
    .select({ branchId: givingTransactions.branchId, amount: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
    .where(
      and(
        eq(givingTransactions.status, "confirmed"),
        gte(givingTransactions.givenOn, from),
        lte(givingTransactions.givenOn, to),
        s.remittanceBasis === "unrestricted" ? eq(givingFunds.restricted, false) : undefined,
      ),
    )
    .groupBy(givingTransactions.branchId);
  let created = 0;
  let updated = 0;
  for (const b of list) {
    if (b.id === hq?.id) continue;
    const inc = Math.max(0, Number(income.find((i) => i.branchId === b.id)?.amount ?? 0));
    const due = Math.round((inc * s.remittanceBps) / 10_000);
    const [existing] = await tx
      .select()
      .from(remittances)
      .where(and(eq(remittances.branchId, b.id), eq(remittances.period, period)));
    if (!existing && inc === 0) continue; // nothing given, nothing owed
    if (!existing) {
      await tx.insert(remittances).values({ orgId, branchId: b.id, period, incomeKobo: inc, rateBps: s.remittanceBps, dueKobo: due });
      created++;
    } else if (existing.status === "due" && (Number(existing.incomeKobo) !== inc || existing.rateBps !== s.remittanceBps)) {
      await tx
        .update(remittances)
        .set({ incomeKobo: inc, rateBps: s.remittanceBps, dueKobo: due })
        .where(eq(remittances.id, existing.id));
      updated++;
    }
  }
  return { created, updated };
}

export async function recalculateRemittances(tx: Tx, ctx: Actor, period: string) {
  assertCan(ctx, "finance.approve", "work out remittances");
  if (ctx.branchIds.length) throw forbidden("work out remittances for every branch");
  const r = await calculateRemittances(tx, ctx.org.id, period);
  await audit(tx, ctx, {
    action: "remittance.calculated",
    summary: `Worked out branch remittances for ${formatPeriod(period)} (${r.created} new, ${r.updated} updated)`,
    entityType: "remittance",
  });
  return r;
}

export const formatPeriod = (period: string) =>
  new Date(`${period}-15T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });

export async function listRemittances(tx: Tx, ctx: Actor, opts: { period?: string; status?: string } = {}) {
  assertCan(ctx, "finance.expenses", "see remittances");
  const rows = await tx
    .select({ r: remittances, branchName: branches.name, branchCode: branches.code })
    .from(remittances)
    .innerJoin(branches, eq(branches.id, remittances.branchId))
    .where(
      and(
        branchScope(ctx, remittances.branchId),
        opts.period ? eq(remittances.period, opts.period) : undefined,
        opts.status === "due" || opts.status === "submitted" || opts.status === "confirmed"
          ? eq(remittances.status, opts.status)
          : undefined,
      ),
    )
    .orderBy(desc(remittances.period), asc(branches.name))
    .limit(500);
  return rows.map((x) => ({
    ...x.r,
    incomeKobo: Number(x.r.incomeKobo),
    dueKobo: Number(x.r.dueKobo),
    paidKobo: Number(x.r.paidKobo),
    branchName: x.branchName,
    branchCode: x.branchCode,
    canSubmit: x.r.status !== "confirmed" && ctx.can("finance.expenses"),
    canConfirm: x.r.status === "submitted" && ctx.can("finance.approve") && x.r.submittedBy !== ctx.user.id && !ctx.branchIds.length,
  }));
}
export type RemittanceRow = Awaited<ReturnType<typeof listRemittances>>[number];

export const remitSchema = z.object({
  id: z.string().uuid(),
  amount: money(),
  paidOn: isoDate("Choose the date it was paid."),
  method: z.enum(EXPENSE_METHODS),
  paymentRef: optText(80),
  note: optText(500),
});

export async function submitRemittance(tx: Tx, ctx: Actor, input: z.output<typeof remitSchema>) {
  assertCan(ctx, "finance.expenses", "record remittances");
  const [r] = await tx.select().from(remittances).where(eq(remittances.id, input.id)).for("update");
  if (!r) throw notFound("That remittance");
  assertBranch(ctx, r.branchId);
  if (r.status === "confirmed") throw new AppError("This remittance is already confirmed.");
  if (input.paidOn > todayISO()) throw new AppError("That date is in the future.", { paidOn: "Choose today or earlier." });
  if (input.method !== "cash" && !input.paymentRef)
    throw new AppError("Add the transfer reference so headquarters can find it.", { paymentRef: "Enter the reference." });
  await tx
    .update(remittances)
    .set({
      status: "submitted",
      paidKobo: input.amount,
      paidOn: input.paidOn,
      method: input.method,
      paymentRef: input.paymentRef,
      note: input.note,
      submittedBy: ctx.user.id,
      submittedByName: ctx.user.name,
      submittedAt: new Date(),
    })
    .where(eq(remittances.id, r.id));
  const [b] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, r.branchId));
  await audit(tx, ctx, {
    action: "remittance.submitted",
    summary: `Recorded ${b?.name}'s ${formatPeriod(r.period)} remittance: ${naira(input.amount)} of ${naira(Number(r.dueKobo))} due`,
    entityType: "remittance",
    entityId: r.id,
  });
}

export async function confirmRemittance(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "finance.approve", "confirm remittances");
  if (ctx.branchIds.length) throw forbidden("confirm remittances for headquarters");
  const [r] = await tx.select().from(remittances).where(eq(remittances.id, id)).for("update");
  if (!r) throw notFound("That remittance");
  if (r.status !== "submitted") throw new AppError("Only recorded payments can be confirmed.");
  if (r.submittedBy === ctx.user.id)
    throw new AppError("You recorded this payment, so someone else must confirm it arrived.");
  await tx
    .update(remittances)
    .set({ status: "confirmed", confirmedBy: ctx.user.id, confirmedByName: ctx.user.name, confirmedAt: new Date() })
    .where(eq(remittances.id, id));
  const [b] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, r.branchId));
  await audit(tx, ctx, {
    action: "remittance.confirmed",
    summary: `Confirmed ${naira(Number(r.paidKobo))} received from ${b?.name} for ${formatPeriod(r.period)}`,
    entityType: "remittance",
    entityId: id,
  });
}

/* ================= fixed assets ================= */

import { ASSET_CATEGORY_LABEL, DEFAULT_LIFE } from "@/lib/assets";
export { ASSET_CATEGORY_LABEL, DEFAULT_LIFE };

export const assetSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().uuid("Choose a branch."),
  name: z.string().trim().min(2, "Name the item.").max(120),
  category: z.enum(ASSET_CATEGORIES),
  description: optText(500),
  serialNo: optText(80),
  location: optText(120),
  custodian: optText(120),
  purchasedOn: z
    .string()
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a date."),
  cost: money({ allowZero: true }),
  usefulLifeMonths: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, c) => {
      if (v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 1200) {
        c.addIssue({ code: "custom", message: "Enter months between 1 and 1200, or leave empty." });
        return z.NEVER;
      }
      return n;
    }),
  salvage: money({ allowZero: true }).optional().default(0),
  condition: z.enum(["new", "good", "fair", "poor", "broken"]),
  status: z.enum(["in_use", "in_repair", "lost"]).default("in_use"),
});

/** Straight-line book value: cost less wear, never below the salvage value. */
export function bookValue(
  a: { costKobo: number; salvageKobo: number; usefulLifeMonths: number | null; purchasedOn: string | null; status: string },
  asOf = todayISO(),
) {
  if (a.status === "disposed") return 0;
  if (!a.usefulLifeMonths || !a.purchasedOn) return a.costKobo;
  const [y1, m1] = a.purchasedOn.split("-").map(Number) as [number, number];
  const [y2, m2] = asOf.split("-").map(Number) as [number, number];
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1));
  const wear = Math.round(((a.costKobo - a.salvageKobo) * Math.min(months, a.usefulLifeMonths)) / a.usefulLifeMonths);
  return Math.max(a.salvageKobo, a.costKobo - wear);
}

export async function saveAsset(tx: Tx, ctx: Actor, input: z.output<typeof assetSchema>) {
  assertCan(ctx, "finance.expenses", "manage assets");
  assertBranch(ctx, input.branchId);
  if (input.purchasedOn && input.purchasedOn > todayISO())
    throw new AppError("That date is in the future.", { purchasedOn: "Choose today or earlier." });
  if (input.salvage > input.cost) throw new AppError("The value at the end can't be more than the cost.", { salvage: "Lower this." });
  const values = {
    branchId: input.branchId,
    name: input.name,
    category: input.category,
    description: input.description,
    serialNo: input.serialNo,
    location: input.location,
    custodian: input.custodian,
    purchasedOn: input.purchasedOn,
    costKobo: input.cost,
    usefulLifeMonths: input.category === "land" ? null : input.usefulLifeMonths,
    salvageKobo: input.salvage,
    condition: input.condition,
    status: input.status,
  };
  if (input.id) {
    const [a] = await tx.select().from(assets).where(eq(assets.id, input.id)).for("update");
    if (!a) throw notFound("That asset");
    assertBranch(ctx, a.branchId);
    if (a.status === "disposed") throw new AppError("This asset has been disposed of and can't be edited.");
    await tx.update(assets).set(values).where(eq(assets.id, a.id));
    const changed = (Object.keys(values) as (keyof typeof values)[]).filter(
      (k) => String(values[k] ?? "") !== String((a as Record<string, unknown>)[k] ?? ""),
    );
    await audit(tx, ctx, {
      action: "asset.updated",
      summary: `Updated asset ${a.assetNo} ${input.name}${changed.length ? ` (${changed.join(", ")})` : ""}`,
      entityType: "asset",
      entityId: a.id,
    });
    return a.id;
  }
  const assetNo = await nextNo(tx, ctx.org.id, "asset", 0);
  const [a] = await tx
    .insert(assets)
    .values({ ...values, orgId: ctx.org.id, assetNo, createdBy: ctx.user.id })
    .returning({ id: assets.id });
  await audit(tx, ctx, {
    action: "asset.created",
    summary: `Added asset ${assetNo} ${input.name} (${naira(input.cost)})`,
    entityType: "asset",
    entityId: a!.id,
  });
  return a!.id;
}

export const disposeSchema = z.object({
  id: z.string().uuid(),
  disposedOn: isoDate("Choose the date."),
  amount: money({ allowZero: true }),
  note: z.string().trim().min(3, "Say what happened to it, e.g. sold to a member, scrapped.").max(500),
});

export async function disposeAsset(tx: Tx, ctx: Actor, input: z.output<typeof disposeSchema>) {
  assertCan(ctx, "finance.expenses", "dispose of assets");
  const [a] = await tx.select().from(assets).where(eq(assets.id, input.id)).for("update");
  if (!a) throw notFound("That asset");
  assertBranch(ctx, a.branchId);
  if (a.status === "disposed") throw new AppError("This asset was already disposed of.");
  if (input.disposedOn > todayISO()) throw new AppError("That date is in the future.", { disposedOn: "Choose today or earlier." });
  const value = bookValue({ ...a, costKobo: Number(a.costKobo), salvageKobo: Number(a.salvageKobo), purchasedOn: a.purchasedOn ? String(a.purchasedOn) : null }, input.disposedOn);
  await tx
    .update(assets)
    .set({ status: "disposed", disposedOn: input.disposedOn, disposalKobo: input.amount, disposalNote: input.note })
    .where(eq(assets.id, a.id));
  const diff = input.amount - value;
  await audit(tx, ctx, {
    action: "asset.disposed",
    summary: `Disposed of ${a.assetNo} ${a.name} for ${naira(input.amount)} (book value ${naira(value)}, ${diff >= 0 ? "gain" : "loss"} of ${naira(Math.abs(diff))}): ${input.note}`,
    entityType: "asset",
    entityId: a.id,
  });
}

export async function listAssets(tx: Tx, ctx: Actor, opts: { category?: string; branchId?: string; status?: string; q?: string } = {}) {
  assertCan(ctx, "finance.expenses", "see assets");
  const q = opts.q?.trim();
  const rows = await tx
    .select({ a: assets, branchName: branches.name })
    .from(assets)
    .innerJoin(branches, eq(branches.id, assets.branchId))
    .where(
      and(
        branchScope(ctx, assets.branchId),
        opts.category && opts.category in ASSET_CATEGORY_LABEL
          ? eq(assets.category, opts.category as (typeof ASSET_CATEGORIES)[number])
          : undefined,
        opts.branchId ? eq(assets.branchId, opts.branchId) : undefined,
        opts.status === "disposed" ? eq(assets.status, "disposed") : opts.status === "all" ? undefined : ne(assets.status, "disposed"),
        q
          ? or(
              ilike(assets.name, `%${q}%`),
              ilike(assets.assetNo, `%${q}%`),
              ilike(assets.serialNo, `%${q}%`),
              ilike(assets.custodian, `%${q}%`),
              ilike(assets.location, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(assets.assetNo))
    .limit(1000);
  const today = todayISO();
  const list = rows.map(({ a, branchName }) => {
    const x = {
      ...a,
      costKobo: Number(a.costKobo),
      salvageKobo: Number(a.salvageKobo),
      disposalKobo: a.disposalKobo == null ? null : Number(a.disposalKobo),
      purchasedOn: a.purchasedOn ? String(a.purchasedOn) : null,
      disposedOn: a.disposedOn ? String(a.disposedOn) : null,
      branchName,
    };
    return { ...x, bookValueKobo: bookValue(x, today) };
  });
  return {
    rows: list,
    totals: {
      cost: list.filter((a) => a.status !== "disposed").reduce((s, a) => s + a.costKobo, 0),
      book: list.reduce((s, a) => s + a.bookValueKobo, 0),
      count: list.filter((a) => a.status !== "disposed").length,
      needsAttention: list.filter((a) => a.status === "in_repair" || a.condition === "poor" || a.condition === "broken").length,
    },
  };
}
export type AssetRow = Awaited<ReturnType<typeof listAssets>>["rows"][number];

export async function getAsset(tx: Tx, ctx: Actor, id: string) {
  const { rows } = await listAssets(tx, ctx, { status: "all" });
  const a = rows.find((r) => r.id === id);
  if (!a) throw notFound("That asset");
  return a;
}
