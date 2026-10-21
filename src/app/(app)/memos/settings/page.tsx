import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listMemoTemplates, listRoute, memoPrefix } from "@/server/services/memos";
import { NoAccess } from "@/components/no-access";
import { MemoSettingsView } from "./view";

export const metadata: Metadata = { title: "Memo settings" };

export default async function MemoSettingsPage() {
  const ctx = await requireCtx();
  if (!ctx.can("settings.manage")) return <NoAccess what="change memo settings" />;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    route: await listRoute(tx),
    templates: await listMemoTemplates(tx),
    prefix: await memoPrefix(tx, ctx.org.id),
  }));
  return (
    <MemoSettingsView
      prefix={data.prefix}
      steps={data.route.steps.map((s) => ({ label: s.label, roleKey: s.roleKey ?? "", minAmount: s.minAmountKobo ? String(s.minAmountKobo / 100) : "" }))}
      roles={data.route.roles}
      templates={data.templates.map((t) => ({ id: t.id, name: t.name, category: t.category, subject: t.subject, body: t.body, needsAmount: t.needsAmount }))}
    />
  );
}
