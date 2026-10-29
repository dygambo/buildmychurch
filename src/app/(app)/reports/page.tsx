import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { NoAccess } from "@/components/no-access";
import { listBranches } from "@/server/services/org";
import { attendanceReport, branchComparison, financeReport, givingReport, growth, overview } from "@/server/services/reports";
import { resolvePeriod } from "@/lib/periods";
import { ReportsView } from "./view";

export const metadata: Metadata = { title: "Reports" };

type SP = { period?: string; from?: string; to?: string; branch?: string; tab?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  if (!ctx.can("reports.read")) return <NoAccess what="see reports" />;
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const data = await withOrg(ctx.org.id, async (tx) => {
    const branches = (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)).map((b) => ({ id: b.id, name: b.name }));
    const branchId = branches.some((b) => b.id === sp.branch) ? sp.branch! : null;
    const s = { ...period, branchId };
    const tabs = ["overview", "growth", "attendance", ...(ctx.can("giving.read") ? ["giving"] : []), ...(ctx.can("finance.expenses") ? ["finance"] : []), ...(branches.length > 1 && !branchId ? ["branches"] : [])];
    const tab = tabs.includes(sp.tab ?? "") ? sp.tab! : "overview";
    return {
      branches,
      branchId,
      tabs,
      tab,
      kpis: await overview(tx, ctx, s),
      growth: tab === "overview" || tab === "growth" ? await growth(tx, ctx, s) : null,
      attendance: tab === "overview" || tab === "attendance" ? await attendanceReport(tx, ctx, s) : null,
      giving: (tab === "overview" || tab === "giving") && ctx.can("giving.read") ? await givingReport(tx, ctx, s) : null,
      finance: tab === "finance" ? await financeReport(tx, ctx, s) : null,
      compare: tab === "branches" ? await branchComparison(tx, ctx, s) : null,
    };
  });
  return <ReportsView period={period} {...data} />;
}
