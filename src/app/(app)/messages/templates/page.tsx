import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listTemplates } from "@/server/services/messaging";
import { NoAccess } from "@/components/no-access";
import { TemplatesView } from "./view";

export const metadata: Metadata = { title: "Message templates" };

export default async function TemplatesPage() {
  const ctx = await requireCtx();
  if (!ctx.can("messaging.manage")) return <NoAccess what="manage templates" />;
  const rows = await withOrg(ctx.org.id, (tx) => listTemplates(tx));
  return <TemplatesView rows={rows.map((t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, body: t.body }))} />;
}
