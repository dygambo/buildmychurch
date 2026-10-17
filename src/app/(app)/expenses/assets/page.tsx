import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listAssets } from "@/server/services/expenses";
import { listBranches } from "@/server/services/org";
import { AssetsView } from "./view";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; branch?: string }>;
}) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listAssets(tx, ctx, { q: sp.q, category: sp.category, status: sp.status, branchId: sp.branch }),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <AssetsView
      list={data.list}
      filters={{ category: sp.category ?? "", status: sp.status ?? "", branch: sp.branch ?? "" }}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
    />
  );
}
