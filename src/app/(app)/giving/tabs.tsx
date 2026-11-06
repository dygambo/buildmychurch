"use client";
import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/ui/tabs";

export function GivingTabs({ canRead, canManage }: { canRead: boolean; canManage: boolean }) {
  const path = usePathname();
  const current = path.startsWith("/giving/transactions")
    ? "tx"
    : path.startsWith("/giving/batches")
      ? "batches"
      : path.startsWith("/giving/pledges")
        ? "pledges"
        : path.startsWith("/giving/settings")
          ? "settings"
          : "overview";
  return (
    <LinkTabs
      className="self-start"
      current={current}
      tabs={[
        ...(canRead ? [{ key: "overview", label: "Overview", href: "/giving" }] : []),
        ...(canRead ? [{ key: "tx", label: "Transactions", href: "/giving/transactions" }] : []),
        { key: "batches", label: "Collections", href: "/giving/batches" },
        ...(canRead ? [{ key: "pledges", label: "Projects & pledges", href: "/giving/pledges" }] : []),
        ...(canManage ? [{ key: "settings", label: "Settings", href: "/giving/settings" }] : []),
      ]}
    />
  );
}
