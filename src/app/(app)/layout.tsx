import { requireCtx, userOrgs } from "@/server/auth/context";
import { AppShell } from "@/components/shell/sidebar";
import { visibleNav } from "@/components/shell/nav";
import { signOutAction } from "../(auth)/actions";
import { switchOrgAction } from "./shell-actions";
import { navBadges } from "@/server/services/badges";
import type { Metadata } from "next";
import { getCtx } from "@/server/auth/context";
import { brandUrl, getBrand } from "@/server/services/brand";
import { BrandStyle } from "@/components/brand-style";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getCtx();
  if (!ctx) return {};
  const icon = brandUrl(ctx.org.id, "favicon", await getBrand(ctx.org.id));
  return icon ? { icons: { icon } } : {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [orgs, badges, brand] = await Promise.all([userOrgs(ctx.user.id), navBadges(ctx), getBrand(ctx.org.id)]);
  return (
    <>
      <BrandStyle accent={brand.accent} />
      <AppShell
        nav={visibleNav(ctx.can)}
        badges={badges}
        user={{ name: ctx.user.name, email: ctx.user.email, role: ctx.membership.roleName }}
        org={{ id: ctx.org.id, name: ctx.org.name, plan: ctx.org.plan, logoUrl: brandUrl(ctx.org.id, "logo", brand) }}
        orgs={orgs}
        switchOrg={switchOrgAction}
        signOut={signOutAction}
      >
        {children}
      </AppShell>
    </>
  );
}
