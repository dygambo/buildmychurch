import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getGroup } from "@/server/services/groups";
import { listBranches } from "@/server/services/org";
import { AppError } from "@/server/errors";
import { NoAccess } from "@/components/no-access";
import { GroupDetail } from "./view";

export const metadata: Metadata = { title: "Group" };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("groups.manage") && !ctx.can("members.read")) return <NoAccess what="see groups" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    data = await withOrg(ctx.org.id, async (tx) => ({
      g: await getGroup(tx, ctx, id),
      branches: await listBranches(tx),
    }));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { g, branches } = data;
  return (
    <GroupDetail
      group={{ ...g, people: g.people.map((p) => ({ ...p, joinedAt: p.joinedAt.toISOString() })) }}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={ctx.can("groups.manage")}
      canSeeMembers={ctx.can("members.read")}
    />
  );
}
