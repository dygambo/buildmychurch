import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listBranches } from "@/server/services/org";
import { counsellors, listCases, oversees, requestLink, upcomingSessions } from "@/server/services/counselling";
import { CounsellingView } from "./view";

export const metadata: Metadata = { title: "Marriage counselling" };

type SP = { tab?: string; kind?: string; mine?: string; q?: string };

export default async function CounsellingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const data = await withOrg(ctx.org.id, async (tx) => {
    const all = await listCases(tx, ctx, { tab: "all", mine: sp.mine === "1" });
    return {
      cases: await listCases(tx, ctx, { tab: sp.tab, kind: sp.kind, mine: sp.mine === "1", q: sp.q }),
      counts: {
        enquiry: all.filter((c) => c.status === "enquiry").length,
        active: all.filter((c) => c.status === "active").length,
        on_hold: all.filter((c) => c.status === "on_hold").length,
        cleared: all.filter((c) => c.outcome === "cleared" && c.createdAt.getFullYear() === new Date().getFullYear()).length,
      },
      upcoming: await upcomingSessions(tx, ctx),
      team: (await counsellors(tx, ctx.org.id)).map((t) => ({ id: t.id, name: t.name })),
      branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)).map((b) => ({ id: b.id, name: b.name })),
      link: await requestLink(tx, ctx),
    };
  });
  return <CounsellingView {...data} filters={sp} canOversee={oversees(ctx)} me={ctx.user.id} />;
}
