import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listGroups, type GroupKind } from "@/server/services/groups";
import { listBranches } from "@/server/services/org";
import { NoAccess } from "@/components/no-access";
import { GroupsView } from "./view";

export const metadata: Metadata = { title: "Groups & cells" };

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; archived?: string }>;
}) {
  const ctx = await requireCtx();
  if (!ctx.can("groups.manage") && !ctx.can("members.read")) return <NoAccess what="see groups" />;
  const sp = await searchParams;
  const kind: GroupKind = sp.kind === "cell" || sp.kind === "ministry" ? sp.kind : "department";
  const { groups, branches } = await withOrg(ctx.org.id, async (tx) => ({
    groups: await listGroups(tx, ctx, { includeArchived: true }),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <GroupsView
      kind={kind}
      showArchived={sp.archived === "1"}
      groups={groups}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={ctx.can("groups.manage")}
    />
  );
}
