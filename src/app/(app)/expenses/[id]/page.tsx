import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getExpense, listCategories } from "@/server/services/expenses";
import { listFiles } from "@/server/services/files";
import { listFunds } from "@/server/services/giving";
import { listBranches } from "@/server/services/org";
import { ExpenseDetail } from "./detail";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const data = await withOrg(ctx.org.id, async (tx) => ({
    e: await getExpense(tx, ctx, id),
    files: await listFiles(tx, "expense", id),
    categories: await listCategories(tx),
    funds: await listFunds(tx),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <ExpenseDetail
      e={data.e}
      files={data.files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
      categories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restricted }))}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
    />
  );
}
