import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listBranches, listRoles, listTeam } from "@/server/services/org";
import { teamMemberLinks } from "@/server/services/team";
import { TeamView } from "./view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireCtx();
  if (!ctx.can("users.manage")) redirect("/settings/account");
  const { team, roles, branches, links } = await withOrg(ctx.org.id, async (tx) => {
    const team = await listTeam(tx, ctx);
    return {
      team,
      roles: await listRoles(tx, ctx),
      branches: await listBranches(tx),
      links: await teamMemberLinks(tx, team.people.map((p) => ({ membershipId: p.m.id, memberId: p.m.memberId, email: p.u.email }))),
    };
  });
  return (
    <TeamView
      me={ctx.user.id}
      iAmOwner={ctx.membership.roleKey === "owner"}
      canEditMembers={ctx.can("members.write")}
      people={team.people.map((p) => ({
        membershipId: p.m.id,
        userId: p.u.id,
        name: p.u.name,
        email: p.u.email,
        roleId: p.r.id,
        roleName: p.r.name,
        roleKey: p.r.key,
        branchIds: p.m.branchIds,
        status: p.m.status,
        title: p.m.title ?? "",
        staffId: p.m.staffId ?? "",
        mfa: p.u.mfaEnabled,
        lastLogin: p.u.lastLoginAt?.toISOString() ?? null,
        pendingFirstSignIn: p.u.mustChangePassword,
        memberId: links[p.m.id] ?? null,
      }))}
      invites={team.invites.map((i) => ({
        id: i.id,
        email: i.email ?? "",
        name: String((i.data as { name?: string }).name ?? ""),
        roleId: String((i.data as { roleId?: string }).roleId ?? ""),
        expiresAt: i.expiresAt.toISOString(),
      }))}
      roles={roles.map((r) => ({ id: r.id, name: r.name, key: r.key }))}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
    />
  );
}
