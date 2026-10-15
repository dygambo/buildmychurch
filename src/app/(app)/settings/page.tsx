import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getOrg } from "@/server/services/org";
import { OrgForm } from "./org-form";

export const metadata: Metadata = { title: "Church profile" };

export default async function ChurchSettingsPage() {
  const ctx = await requireCtx();
  if (!ctx.can("settings.manage")) redirect("/settings/account");
  const org = await withOrg(ctx.org.id, (tx) => getOrg(tx, ctx));
  return (
    <OrgForm
      org={{
        name: org.name,
        denomination: org.denomination ?? "",
        state: org.state ?? "",
        lga: org.lga ?? "",
        address: org.address ?? "",
        phone: org.phone ?? "",
        email: org.email ?? "",
        smsSenderId: org.smsSenderId ?? "",
        slug: org.slug,
      }}
    />
  );
}
