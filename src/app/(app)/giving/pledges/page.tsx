import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listCampaigns, listFunds } from "@/server/services/giving";
import { NoAccess } from "@/components/no-access";
import { CampaignsView } from "./view";

export const metadata: Metadata = { title: "Projects and pledges" };

export default async function PledgesPage() {
  const ctx = await requireCtx();
  if (!ctx.can("giving.read")) return <NoAccess what="see projects and pledges" />;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    campaigns: await listCampaigns(tx, ctx),
    funds: await listFunds(tx),
  }));
  return (
    <CampaignsView
      campaigns={data.campaigns}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restricted }))}
      canManage={ctx.can("giving.verify")}
    />
  );
}
