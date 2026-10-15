import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listRoles } from "@/server/services/org";
import { PERMISSIONS } from "@/server/auth/permissions";
import { RolesView } from "./view";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const ctx = await requireCtx();
  if (!ctx.can("users.manage")) redirect("/settings/account");
  const roles = await withOrg(ctx.org.id, (tx) => listRoles(tx, ctx));
  return (
    <RolesView
      roles={roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description ?? "",
        permissions: r.permissions,
        isSystem: r.isSystem,
      }))}
      permissions={PERMISSIONS}
    />
  );
}
