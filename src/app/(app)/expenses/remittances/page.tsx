import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { financeSettings, listRemittances, previousPeriod } from "@/server/services/expenses";
import { listBranches } from "@/server/services/org";
import { RemittancesView } from "./view";

export const metadata: Metadata = { title: "Branch remittances" };

export default async function RemittancesPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : previousPeriod();
  const data = await withOrg(ctx.org.id, async (tx) => ({
    rows: await listRemittances(tx, ctx, { period }),
    outstanding: (await listRemittances(tx, ctx, { status: "due" })).filter((r) => r.period !== period),
    settings: await financeSettings(tx, ctx.org.id),
    branchCount: (await listBranches(tx)).length,
  }));
  return (
    <RemittancesView
      period={period}
      rows={data.rows}
      outstanding={data.outstanding}
      rateBps={data.settings.remittanceBps}
      basis={data.settings.remittanceBasis}
      branchCount={data.branchCount}
      canCalculate={ctx.can("finance.approve") && !ctx.branchIds.length}
    />
  );
}
