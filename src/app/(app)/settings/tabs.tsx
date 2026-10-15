"use client";
import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/ui/tabs";

export function SettingsTabs({ tabs }: { tabs: { key: string; label: string }[] }) {
  const path = usePathname();
  const current = path.replace(/^\/settings\/?/, "").split("/")[0] ?? "";
  return (
    <LinkTabs
      className="self-start"
      current={current}
      tabs={tabs.map((t) => ({ ...t, href: "/settings" + (t.key ? "/" + t.key : "") }))}
    />
  );
}
