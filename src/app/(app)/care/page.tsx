import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { careSummary, careTeam, listCases, listPrayer, prayerLink, seesConfidential } from "@/server/services/care";
import { CareView } from "./view";

export const metadata: Metadata = { title: "Prayer & care" };

type SP = { tab?: string; status?: string; category?: string; kind?: string; q?: string; mine?: string; open?: string };

export default async function CarePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tab = sp.tab === "cases" ? "cases" : "prayer";
  const data = await withOrg(ctx.org.id, async (tx) => ({
    summary: await careSummary(tx, ctx),
    team: (await careTeam(tx, ctx.org.id)).map((t) => ({ id: t.id, name: t.name })),
    link: await prayerLink(tx, ctx),
    prayer: tab === "prayer" ? await listPrayer(tx, ctx, { status: sp.status, category: sp.category, q: sp.q, mine: sp.mine === "1" }) : [],
    cases: tab === "cases" ? await listCases(tx, ctx, { status: sp.status, kind: sp.kind, mine: sp.mine === "1" }) : [],
  }));
  return <CareView tab={tab} {...data} filters={sp} pastor={seesConfidential(ctx)} me={ctx.user.id} />;
}
