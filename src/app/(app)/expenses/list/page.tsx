import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { financeSettings, listCategories, listExpenses, type ExpenseFilters } from "@/server/services/expenses";
import { listFunds } from "@/server/services/giving";
import { listBranches } from "@/server/services/org";
import { ExpensesView } from "./view";

export const metadata: Metadata = { title: "Expenses" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ExpensesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const filters: ExpenseFilters = {
    q: one(sp.q),
    status: one(sp.status),
    categoryId: one(sp.category),
    branchId: one(sp.branch),
    fundId: one(sp.fund),
    from: one(sp.from),
    to: one(sp.to),
    page: Number(one(sp.page)) || 1,
  };
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listExpenses(tx, ctx, filters),
    categories: await listCategories(tx),
    funds: await listFunds(tx),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
    settings: await financeSettings(tx, ctx.org.id),
  }));
  return (
    <ExpensesView
      list={data.list}
      filters={filters}
      userId={ctx.user.id}
      startOpen={one(sp.new) === "1"}
      categories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restricted }))}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      thresholdKobo={data.settings.approvalThresholdKobo}
      canApprove={ctx.can("finance.approve")}
    />
  );
}
