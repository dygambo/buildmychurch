import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs: each tab is a link, so tabs work without JavaScript and survive refresh. */
export function LinkTabs({
  tabs,
  current,
  className,
}: {
  tabs: { key: string; label: React.ReactNode; href: string; count?: number }[];
  current: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px]",
        className,
      )}
      aria-label="Sections"
    >
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={current === t.key ? "page" : undefined}
          className={cn(
            "rounded-[7px] px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg",
            current === t.key && "bg-surface text-fg shadow-[0_1px_2px_rgba(16,30,70,.1)]",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1 font-normal text-faint">({t.count.toLocaleString("en-NG")})</span>}
        </Link>
      ))}
    </nav>
  );
}
