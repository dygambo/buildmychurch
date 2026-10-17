import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import {
  givingPageUrl,
  givingSettings,
  givingSummary,
  listCampaigns,
  listTransactions,
  pendingBatchCount,
} from "@/server/services/giving";
import { paymentsProvider } from "@/server/providers/payments";
import { todayISO } from "@/lib/format";
import { GivingOverview } from "./overview";

export const metadata: Metadata = { title: "Giving" };

export default async function GivingPage() {
  const ctx = await requireCtx();
  if (!ctx.can("giving.read")) redirect("/giving/batches");
  const today = todayISO();
  const data = await withOrg(ctx.org.id, async (tx) => ({
    summary: await givingSummary(tx, ctx, today),
    recent: await listTransactions(tx, ctx, { pageSize: 8 }),
    pending: ctx.can("giving.verify") ? await pendingBatchCount(tx, ctx) : 0,
    campaigns: (await listCampaigns(tx, ctx)).filter((c) => c.status === "active").slice(0, 3),
    settings: await givingSettings(tx, ctx.org.id),
  }));
  let mode: "fake" | "paystack" | "off" = "off";
  try {
    mode = paymentsProvider();
  } catch {}
  const online = mode === "fake" ? "test" : mode === "paystack" && data.settings.subaccountCode ? "live" : "off";
  return (
    <GivingOverview
      today={today}
      summary={data.summary}
      recent={data.recent.rows}
      pending={data.pending}
      campaigns={data.campaigns}
      givingUrl={givingPageUrl(ctx.org.slug)}
      online={online}
      can={{ record: ctx.can("giving.record"), manage: ctx.can("giving.verify") }}
    />
  );
}
