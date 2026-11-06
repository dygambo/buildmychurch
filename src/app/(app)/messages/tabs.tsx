"use client";
import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/ui/tabs";

export function MessagesTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname();
  const seg = path.split("/")[2] ?? "";
  const current = ["automations", "templates", "wallet"].includes(seg) ? seg : "sent";
  return (
    <LinkTabs
      className="self-start"
      current={current}
      tabs={[
        { key: "sent", label: "Messages", href: "/messages" },
        ...(canManage
          ? [
              { key: "automations", label: "Automatic", href: "/messages/automations" },
              { key: "templates", label: "Templates", href: "/messages/templates" },
              { key: "wallet", label: "SMS units", href: "/messages/wallet" },
            ]
          : []),
      ]}
    />
  );
}
