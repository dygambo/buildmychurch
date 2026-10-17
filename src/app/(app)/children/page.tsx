import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { childStats, listChildren } from "@/server/services/children";
import { listBranches } from "@/server/services/org";
import { ChildrenView } from "./view";

export const metadata: Metadata = { title: "Children" };

export default async function ChildrenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; class?: string; here?: string; status?: string }>;
}) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const { rows, stats, branches } = await withOrg(ctx.org.id, async (tx) => ({
    rows: await listChildren(tx, ctx, { q: sp.q, classGroup: sp.class, here: sp.here === "1", status: sp.status }),
    stats: await childStats(tx, ctx),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <ChildrenView
      rows={rows.map((r) => ({ ...r, dob: String(r.dob) }))}
      stats={stats}
      filters={{ q: sp.q, classGroup: sp.class, here: sp.here === "1", status: sp.status }}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={ctx.can("children.manage")}
      canMedical={ctx.can("children.read_medical")}
    />
  );
}
