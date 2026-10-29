import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { givingPageUrl, givingSettings, listFunds } from "@/server/services/giving";
import { paymentsProvider } from "@/server/providers/payments";
import { NoAccess } from "@/components/no-access";
import { GivingSettingsView } from "./view";

export const metadata: Metadata = { title: "Giving settings" };

export default async function GivingSettingsPage() {
  const ctx = await requireCtx();
  if (!ctx.can("giving.verify")) return <NoAccess what="change giving settings" />;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    funds: await listFunds(tx, { includeArchived: true }),
    settings: await givingSettings(tx, ctx.org.id),
  }));
  let mode: "fake" | "paystack" | "off" = "off";
  try {
    mode = paymentsProvider();
  } catch {}
  return (
    <GivingSettingsView
      funds={data.funds.map((f) => ({
        id: f.id,
        name: f.name,
        code: f.code,
        description: f.description,
        restricted: f.restricted,
        online: f.online,
        color: f.color,
        archived: !!f.archivedAt,
      }))}
      settings={data.settings}
      mode={mode}
      givingUrl={givingPageUrl(ctx.org.slug)}
      canPayout={ctx.can("settings.manage") || ctx.membership.roleKey === "finance"}
    />
  );
}
