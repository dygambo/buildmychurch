import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { accountsOverview } from "@/server/services/expenses";
import { todayISO } from "@/lib/format";
import { AccountsOverview } from "./overview";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireCtx();
  const thisYear = Number(todayISO().slice(0, 4));
  const y = Number((await searchParams).year);
  const year = y >= 2000 && y <= thisYear ? y : thisYear;
  const data = await withOrg(ctx.org.id, (tx) => accountsOverview(tx, ctx, year));
  return (
    <AccountsOverview
      data={{ ...data, funds: [...data.funds], unassignedSpendKobo: data.funds.unassignedSpendKobo, openingDate: data.funds.openingDate }}
      thisYear={thisYear}
      canApprove={ctx.can("finance.approve")}
    />
  );
}
