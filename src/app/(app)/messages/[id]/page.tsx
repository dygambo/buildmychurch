import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getCampaign } from "@/server/services/messaging";
import { NoAccess } from "@/components/no-access";
import { CampaignDetail } from "./detail";

export const metadata: Metadata = { title: "Message" };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.can("messaging.send")) return <NoAccess what="see messages" />;
  const c = await withOrg(ctx.org.id, (tx) => getCampaign(tx, ctx, id, { status: sp.status, page: Number(sp.page) || 1 }));
  return <CampaignDetail c={c} status={sp.status ?? ""} />;
}
