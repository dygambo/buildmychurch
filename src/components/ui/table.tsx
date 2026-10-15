import { cn } from "@/lib/utils";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)}>{children}</table>
    </div>
  );
}
export function Th({ className, children, num }: { className?: string; children?: React.ReactNode; num?: boolean }) {
  return (
    <th
      className={cn(
        "border-b border-line px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-faint",
        num && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({
  className,
  children,
  num,
  ...p
}: React.TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-line px-3 py-2.5 align-middle",
        num && "tabular text-right whitespace-nowrap",
        className,
      )}
      {...p}
    >
      {children}
    </td>
  );
}
export function Tr({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("[&:last-child>td]:border-b-0", className)} {...p} />;
}
