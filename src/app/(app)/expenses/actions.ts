"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  approveExpense,
  assetSchema,
  budgetSchema,
  categorySchema,
  confirmRemittance,
  deleteExpense,
  disposeAsset,
  disposeSchema,
  expenseSchema,
  financeSettingsSchema,
  markExpensePaid,
  openingBalancesSchema,
  paySchema,
  recalculateRemittances,
  rejectExpense,
  rejectSchema,
  remitSchema,
  saveApprovalRules,
  saveAsset,
  saveBudget,
  saveCategory,
  saveExpense,
  saveOpeningBalances,
  setCategoryArchived,
  submitExpense,
  submitRemittance,
  voidExpense,
  voidSchema,
} from "@/server/services/expenses";
import { removeFile } from "@/server/services/files";
import { naira } from "@/lib/format";

const uuid = z.string().uuid();
const refresh = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));
const all = () => refresh("/expenses", "/expenses/list");

/* ---------- expenses ---------- */

export const saveExpenseAction = orgAction(
  { perm: "finance.expenses", schema: expenseSchema.extend({ submit: z.boolean().optional() }) },
  async ({ submit, ...input }, ctx, tx) => {
    const id = await saveExpense(tx, ctx, input);
    let status: string = "draft";
    if (submit) status = (await submitExpense(tx, ctx, id)).status;
    all();
    refresh(`/expenses/${id}`);
    return {
      data: { id, status },
      message:
        status === "approved"
          ? "Saved and approved: it's within the approval limit"
          : status === "submitted"
            ? "Sent for approval"
            : "Saved as a draft",
    };
  },
);

export const submitExpenseAction = orgAction(
  { perm: "finance.expenses", schema: z.object({ id: uuid }) },
  async ({ id }, ctx, tx) => {
    const r = await submitExpense(tx, ctx, id);
    all();
    refresh(`/expenses/${id}`);
    return { data: r, message: r.status === "approved" ? "Approved: it's within the approval limit" : "Sent for approval" };
  },
);

export const approveExpenseAction = orgAction({ perm: "finance.approve", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await approveExpense(tx, ctx, id);
  all();
  refresh(`/expenses/${id}`);
  return { data: null, message: "Approved" };
});

export const rejectExpenseAction = orgAction({ perm: "finance.approve", schema: rejectSchema }, async (input, ctx, tx) => {
  await rejectExpense(tx, ctx, input);
  all();
  refresh(`/expenses/${input.id}`);
  return { data: null, message: "Sent back" };
});

export const payExpenseAction = orgAction({ perm: "finance.expenses", schema: paySchema }, async (input, ctx, tx) => {
  await markExpensePaid(tx, ctx, input);
  all();
  refresh(`/expenses/${input.id}`);
  return { data: null, message: "Marked paid" };
});

export const voidExpenseAction = orgAction({ perm: "finance.approve", schema: voidSchema }, async (input, ctx, tx) => {
  await voidExpense(tx, ctx, input);
  all();
  refresh(`/expenses/${input.id}`);
  return { data: null, message: "Voided" };
});

export const deleteExpenseAction = orgAction({ perm: "finance.expenses", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await deleteExpense(tx, ctx, id);
  all();
  return { data: null, message: "Draft deleted" };
});

export const removeFileAction = orgAction(
  { perm: "finance.expenses", schema: z.object({ id: uuid, path: z.string().startsWith("/expenses") }) },
  async ({ id, path }, ctx, tx) => {
    await removeFile(tx, ctx, id);
    refresh(path);
    return { data: null, message: "File removed" };
  },
);

/* ---------- budgets ---------- */

export const saveBudgetAction = orgAction({ perm: "finance.expenses", schema: budgetSchema }, async (input, ctx, tx) => {
  const total = await saveBudget(tx, ctx, input);
  refresh("/expenses/budgets", "/expenses");
  return { data: null, message: `Budget saved: ${naira(total)} for the year` };
});

/* ---------- remittances ---------- */

export const calculateRemittancesAction = orgAction(
  { perm: "finance.approve", schema: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month.") }) },
  async ({ period }, ctx, tx) => {
    const r = await recalculateRemittances(tx, ctx, period);
    refresh("/expenses/remittances");
    return {
      data: r,
      message: r.created || r.updated ? `Worked out ${r.created + r.updated} branch remittance${r.created + r.updated === 1 ? "" : "s"}` : "Already up to date",
    };
  },
);

export const submitRemittanceAction = orgAction({ perm: "finance.expenses", schema: remitSchema }, async (input, ctx, tx) => {
  await submitRemittance(tx, ctx, input);
  refresh("/expenses/remittances");
  return { data: null, message: "Payment recorded. Headquarters confirms it next." };
});

export const confirmRemittanceAction = orgAction({ perm: "finance.approve", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await confirmRemittance(tx, ctx, id);
  refresh("/expenses/remittances");
  return { data: null, message: "Confirmed as received" };
});

/* ---------- assets ---------- */

export const saveAssetAction = orgAction({ perm: "finance.expenses", schema: assetSchema }, async (input, ctx, tx) => {
  const id = await saveAsset(tx, ctx, input);
  refresh("/expenses/assets");
  return { data: { id }, message: input.id ? "Asset updated" : "Asset added" };
});

export const disposeAssetAction = orgAction({ perm: "finance.expenses", schema: disposeSchema }, async (input, ctx, tx) => {
  await disposeAsset(tx, ctx, input);
  refresh("/expenses/assets");
  return { data: null, message: "Recorded as disposed" };
});

/* ---------- settings ---------- */

export const saveRulesAction = orgAction({ perm: "finance.approve", schema: financeSettingsSchema }, async (input, ctx, tx) => {
  await saveApprovalRules(tx, ctx, input);
  refresh("/expenses/settings");
  return { data: null, message: "Saved" };
});

export const saveOpeningAction = orgAction({ perm: "finance.approve", schema: openingBalancesSchema }, async (input, ctx, tx) => {
  await saveOpeningBalances(tx, ctx, input);
  refresh("/expenses/settings", "/expenses");
  return { data: null, message: "Opening balances saved" };
});

export const saveCategoryAction = orgAction({ perm: "finance.approve", schema: categorySchema }, async (input, ctx, tx) => {
  await saveCategory(tx, ctx, input);
  refresh("/expenses/settings");
  return { data: null, message: input.id ? "Category updated" : "Category added" };
});

export const archiveCategoryAction = orgAction(
  { perm: "finance.approve", schema: z.object({ id: uuid, archived: z.boolean() }) },
  async ({ id, archived }, ctx, tx) => {
    await setCategoryArchived(tx, ctx, id, archived);
    refresh("/expenses/settings");
    return { data: null, message: archived ? "Category closed" : "Category reopened" };
  },
);
