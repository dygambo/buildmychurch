import { SettingsTabs } from "./tabs";
import { requireCtx } from "@/server/auth/context";
import { PageHeader } from "@/components/ui/page-header";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const tabs = [
    ctx.can("settings.manage") && { key: "", label: "Church profile" },
    ctx.can("users.manage") && { key: "team", label: "Team" },
    ctx.can("users.manage") && { key: "roles", label: "Roles & permissions" },
    { key: "account", label: "My account" },
    ctx.can("audit.read") && { key: "audit", label: "Audit log" },
  ].filter(Boolean) as { key: string; label: string }[];
  return (
    <>
      <PageHeader title="Settings" description="Your church, your team and your own account." />
      <SettingsTabs tabs={tabs} />
      {children}
    </>
  );
}
