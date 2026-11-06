import { cn } from "@/lib/utils";

/** Build My Church mark: a cross set in rising courses of stone. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role="img" aria-label="Build My Church">
      <rect width="32" height="32" rx="9" fill="#fff" />
      <path d="M16 6v14M11 11h10" stroke="var(--accent, #2357e8)" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 24h16M10 27.5h12" stroke="var(--accent, #2357e8)" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
