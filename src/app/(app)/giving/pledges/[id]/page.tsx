import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getCampaign, givingPageUrl, listFunds } from "@/server/services/giving";
import { NoAccess } from "@/components/no-access";
import { CampaignDetail } from "./detail";

export const metadata: Metadata = { title: "Project" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!ctx.can("giving.read")) return <NoAccess what="see projects" />;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    c: await getCampaign(tx, ctx, id),
    funds: await listFunds(tx),
  }));
  return (
    <CampaignDetail
      c={data.c}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restricted }))}
      giveUrl={`${givingPageUrl(ctx.org.slug)}?project=${id}`}
      can={{
        manage: ctx.can("giving.verify"),
        pledge: ctx.can("giving.record") && ctx.can("giving.read_named"),
        named: ctx.can("giving.read_named"),
      }}
    />
  );
}
