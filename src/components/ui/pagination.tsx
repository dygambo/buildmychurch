import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (p: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const btn =
    "inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-surface px-2.5 text-xs font-medium hover:bg-surface-2";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-3">
      <span className="text-[12.5px] text-muted">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link className={btn} href={hrefFor(page - 1)} scroll={false}>
            <ChevronLeft className="size-3.5" /> Previous
          </Link>
        ) : (
          <span className={btn + " pointer-events-none opacity-40"}>
            <ChevronLeft className="size-3.5" /> Previous
          </span>
        )}
        <span className="font-mono text-xs text-faint">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className={btn} href={hrefFor(page + 1)} scroll={false}>
            Next <ChevronRight className="size-3.5" />
          </Link>
        ) : (
          <span className={btn + " pointer-events-none opacity-40"}>
            Next <ChevronRight className="size-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
