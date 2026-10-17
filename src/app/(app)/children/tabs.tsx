"use client";
import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/ui/tabs";

export function ChildrenTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname();
  const current = path.startsWith("/children/desk")
    ? "desk"
    : path.startsWith("/children/records")
      ? "records"
      : "list";
  return (
    <LinkTabs
      className="self-start"
      current={current}
      tabs={[
        { key: "desk", label: "Check-in desk", href: "/children/desk" },
        { key: "list", label: "Children", href: "/children" },
        ...(canManage ? [{ key: "records", label: "Records", href: "/children/records" }] : []),
      ]}
    />
  );
}
