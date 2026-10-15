import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listBranches } from "@/server/services/org";
import { NoAccess } from "@/components/no-access";
import { BranchesView } from "./view";

export const metadata: Metadata = { title: "Branches" };

export default async function BranchesPage() {
  const ctx = await requireCtx();
  if (!ctx.can("branches.manage")) return <NoAccess what="manage branches" />;
  const rows = await withOrg(ctx.org.id, (tx) => listBranches(tx, true));
  return (
    <BranchesView
      branches={rows.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        level: b.level,
        parentId: b.parentId,
        depth: b.path.split(".").length - 1,
        address: b.address ?? "",
        phone: b.phone ?? "",
        pastorName: b.pastorName ?? "",
        archived: !!b.archivedAt,
      }))}
    />
  );
}
