import { cn, hue } from "@/lib/utils";
import { initials } from "@/lib/format";

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const h = hue(name);
  return (
    <div
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        size === "sm" && "size-[26px] text-[10.5px]",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-14 text-lg",
        className,
      )}
      style={{ background: `hsl(${h} 70% 55% / .16)`, color: `hsl(${h} 62% 46%)` }}
    >
      {initials(name)}
    </div>
  );
}

export function Person({ name, sub, size = "md" }: { name: string; sub?: React.ReactNode; size?: "sm" | "md" }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size={size} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {sub && <div className="truncate text-xs text-faint">{sub}</div>}
      </div>
    </div>
  );
}
