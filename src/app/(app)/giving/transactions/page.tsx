import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listFunds, listTransactions, type TxFilters } from "@/server/services/giving";
import { listBranches } from "@/server/services/org";
import { NoAccess } from "@/components/no-access";
import { TransactionsView } from "./view";

export const metadata: Metadata = { title: "Giving transactions" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function TransactionsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireCtx();
  if (!ctx.can("giving.read")) return <NoAccess what="see giving records" />;
  const sp = await searchParams;
  const filters: TxFilters = {
    q: one(sp.q),
    from: one(sp.from),
    to: one(sp.to),
    fundId: one(sp.fund),
    channel: one(sp.channel),
    status: one(sp.status),
    source: one(sp.source),
    branchId: one(sp.branch),
    page: Number(one(sp.page)) || 1,
  };
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listTransactions(tx, ctx, filters),
    funds: await listFunds(tx, { includeArchived: true }),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <TransactionsView
      list={data.list}
      filters={filters}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name }))}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      can={{
        reverse: ctx.can("giving.reverse"),
        assign: ctx.can("giving.verify") && ctx.can("giving.read_named"),
        named: ctx.can("giving.read_named"),
      }}
    />
  );
}
