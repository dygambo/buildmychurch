"use client";
import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/ui/tabs";

const TABS = [
  { key: "overview", label: "Accounts", href: "/expenses" },
  { key: "list", label: "Expenses", href: "/expenses/list" },
  { key: "budgets", label: "Budgets", href: "/expenses/budgets" },
  { key: "remittances", label: "Remittances", href: "/expenses/remittances" },
  { key: "assets", label: "Assets", href: "/expenses/assets" },
  { key: "settings", label: "Settings", href: "/expenses/settings" },
];

export function ExpensesTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname();
  const seg = path.split("/")[2] ?? "";
  const current = TABS.some((t) => t.key === seg) ? seg : seg ? "list" : "overview";
  return (
    <LinkTabs
      className="self-start"
      current={current}
      tabs={TABS.filter((t) => t.key !== "settings" || canManage)}
    />
  );
}
