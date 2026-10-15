import { Slot } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-accent text-accent-ink border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-surface text-fg border-line-strong hover:bg-surface-2",
  soft: "bg-accent-soft text-accent border-transparent hover:brightness-95",
  ghost: "bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-fg",
  danger: "bg-surface text-bad border-line-strong hover:bg-bad-soft",
  success: "bg-good text-white border-good hover:brightness-110",
} as const;
const sizes = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3 text-[13px] gap-2 rounded-lg",
  lg: "h-11 px-4 text-sm gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg justify-center",
  "icon-sm": "h-7 w-7 rounded-md justify-center",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", asChild, loading, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center border font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
          )}
          {children}
        </>
      )}
    </Comp>
  );
});
