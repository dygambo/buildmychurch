import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getBudget } from "@/server/services/expenses";
import { listBranches } from "@/server/services/org";
import { todayISO } from "@/lib/format";
import { BudgetView } from "./view";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ year?: string; branch?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const thisYear = Number(todayISO().slice(0, 4));
  const y = Number(sp.year);
  const year = y >= 2000 && y <= thisYear + 1 ? y : thisYear;
  const data = await withOrg(ctx.org.id, async (tx) => {
    const branches = (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id));
    const branch = branches.find((b) => b.id === sp.branch) ?? branches.find((b) => b.level === "hq") ?? branches[0]!;
    return { branches, branch, lines: await getBudget(tx, ctx, year, branch.id) };
  });
  return (
    <BudgetView
      key={`${year}-${data.branch.id}`}
      year={year}
      thisYear={thisYear}
      branchId={data.branch.id}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      lines={data.lines}
    />
  );
}
