import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { financeSettings, listCategories } from "@/server/services/expenses";
import { listFunds } from "@/server/services/giving";
import { NoAccess } from "@/components/no-access";
import { FinanceSettingsView } from "./view";

export const metadata: Metadata = { title: "Finance settings" };

export default async function FinanceSettingsPage() {
  const ctx = await requireCtx();
  if (!ctx.can("finance.approve")) return <NoAccess what="change finance settings" />;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    settings: await financeSettings(tx, ctx.org.id),
    categories: await listCategories(tx, { includeArchived: true }),
    funds: await listFunds(tx),
  }));
  return (
    <FinanceSettingsView
      settings={data.settings}
      categories={data.categories.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        description: c.description,
        color: c.color,
        archived: !!c.archivedAt,
      }))}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restricted }))}
    />
  );
}
