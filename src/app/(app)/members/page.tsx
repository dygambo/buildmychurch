import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listMembers, listTags, type MemberFilters } from "@/server/services/members";
import { listGroups } from "@/server/services/groups";
import { listBranches } from "@/server/services/org";
import { NoAccess } from "@/components/no-access";
import { MembersView } from "./view";

export const metadata: Metadata = { title: "Members" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function MembersPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireCtx();
  if (!ctx.can("members.read")) return <NoAccess what="see members" />;
  const sp = await searchParams;
  const filters: MemberFilters = {
    q: one(sp.q),
    stage: one(sp.stage),
    status: one(sp.status),
    branchId: one(sp.branch),
    groupId: one(sp.group),
    tagId: one(sp.tag),
    gender: one(sp.gender),
    birthdays: one(sp.birthdays) === "week" ? "week" : one(sp.birthdays) === "month" ? "month" : undefined,
    page: Number(one(sp.page)) || 1,
  };
  const { list, branches, groups, tags } = await withOrg(ctx.org.id, async (tx) => ({
    list: await listMembers(tx, ctx, filters),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
    groups: await listGroups(tx, ctx),
    tags: await listTags(tx),
  }));
  return (
    <MembersView
      list={{
        ...list,
        rows: list.rows.map((r) => ({ ...r, joinDate: String(r.joinDate) })),
      }}
      filters={filters}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      groups={groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind }))}
      tags={tags.map((t) => ({ id: t.id, name: t.name }))}
      can={{
        write: ctx.can("members.write"),
        import: ctx.can("members.import"),
        export: ctx.can("members.export"),
        sensitive: ctx.can("members.read_sensitive"),
      }}
    />
  );
}
