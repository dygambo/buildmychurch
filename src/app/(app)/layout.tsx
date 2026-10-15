import { requireCtx, userOrgs } from "@/server/auth/context";
import { AppShell } from "@/components/shell/sidebar";
import { visibleNav } from "@/components/shell/nav";
import { signOutAction } from "../(auth)/actions";
import { switchOrgAction } from "./shell-actions";
import { navBadges } from "@/server/services/badges";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [orgs, badges] = await Promise.all([userOrgs(ctx.user.id), navBadges(ctx)]);
  return (
    <AppShell
      nav={visibleNav(ctx.can)}
      badges={badges}
      user={{ name: ctx.user.name, email: ctx.user.email, role: ctx.membership.roleName }}
      org={{ id: ctx.org.id, name: ctx.org.name, plan: ctx.org.plan }}
      orgs={orgs}
      switchOrg={switchOrgAction}
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}
