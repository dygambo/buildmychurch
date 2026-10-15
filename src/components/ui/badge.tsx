import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-surface-3 text-muted",
  accent: "bg-accent-soft text-accent",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  pink: "bg-[color-mix(in_srgb,var(--c2)_14%,transparent)] text-c2",
  purple: "bg-[color-mix(in_srgb,var(--c5)_14%,transparent)] text-c5",
  teal: "bg-[color-mix(in_srgb,var(--c3)_14%,transparent)] text-c3",
} as const;
export type Tone = keyof typeof tones;

export function Badge({
  tone = "neutral",
  className,
  children,
  dot,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function CountBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "bad";
}) {
  return (
    <span
      className={cn(
        "ml-auto rounded-full px-1.5 text-[11px] leading-5 font-semibold",
        tone === "accent"
          ? "bg-accent text-accent-ink"
          : tone === "bad"
            ? "bg-bad-soft text-bad"
            : "bg-surface-3 text-muted",
      )}
    >
      {children}
    </span>
  );
}
