import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listCampaigns, messagingStats } from "@/server/services/messaging";
import { whatsappEnabled } from "@/server/providers/messaging";
import { MessagesView } from "./view";

export const metadata: Metadata = { title: "Messaging" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ status?: string; channel?: string; page?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: ctx.can("messaging.send") ? await listCampaigns(tx, ctx, { status: sp.status, channel: sp.channel, page: Number(sp.page) || 1 }) : null,
    stats: await messagingStats(tx),
  }));
  return (
    <MessagesView
      list={data.list}
      stats={data.stats}
      filters={{ status: sp.status ?? "", channel: sp.channel ?? "" }}
      whatsapp={whatsappEnabled()}
      canManage={ctx.can("messaging.manage")}
    />
  );
}
