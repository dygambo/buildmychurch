"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function PortalNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/m/${slug}`;
  const items = [
    { href: base, label: "Home" },
    { href: `${base}/giving`, label: "Giving" },
    { href: `${base}/prayer`, label: "Prayer" },
    { href: `${base}/profile`, label: "My details" },
  ];
  return (
    <nav aria-label="Member page" className="mx-auto flex max-w-2xl gap-1 overflow-x-auto px-3 pb-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path === i.href ? "page" : undefined}
          className={cn("shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted hover:text-fg", path === i.href && "bg-accent-soft text-accent")}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
