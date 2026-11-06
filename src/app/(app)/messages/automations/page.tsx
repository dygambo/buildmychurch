import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { whatsappEnabled } from "@/server/providers/messaging";
import { AUTOMATIONS, automationSettings, type AutomationKey } from "@/server/services/messaging";
import { NoAccess } from "@/components/no-access";
import { AutomationsView } from "./view";

export const metadata: Metadata = { title: "Automatic messages" };

export default async function AutomationsPage() {
  const ctx = await requireCtx();
  if (!ctx.can("messaging.manage")) return <NoAccess what="change automatic messages" />;
  const settings = await withOrg(ctx.org.id, (tx) => automationSettings(tx, ctx.org.id));
  return (
    <AutomationsView
      church={ctx.org.name}
      whatsapp={whatsappEnabled()}
      items={(Object.keys(AUTOMATIONS) as AutomationKey[]).map((k) => ({
        key: k,
        label: AUTOMATIONS[k].label,
        when: AUTOMATIONS[k].when,
        ...settings[k],
      }))}
    />
  );
}
