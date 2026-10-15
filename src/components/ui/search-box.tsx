"use client";
import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Search input bound to the `q` URL parameter (debounced), so results are shareable and survive refresh. */
export function SearchBox({
  placeholder,
  param = "q",
  className,
}: {
  placeholder: string;
  param?: string;
  className?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const urlValue = sp.get(param) ?? "";
  const [v, setV] = useState(urlValue);
  const [seen, setSeen] = useState(urlValue);
  if (urlValue !== seen) {
    // the URL changed elsewhere (back button, a link): follow it
    setSeen(urlValue);
    setV(urlValue);
  }
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 size-4 text-faint" />
      <input
        type="search"
        value={v}
        aria-label={placeholder}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 text-[13px] placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-accent-line"
        onChange={(e) => {
          const val = e.target.value;
          setV(val);
          clearTimeout(t.current);
          t.current = setTimeout(() => {
            const next = new URLSearchParams(sp.toString());
            if (val) next.set(param, val);
            else next.delete(param);
            next.delete("page");
            router.replace(`${path}?${next}`, { scroll: false });
          }, 250);
        }}
      />
    </div>
  );
}
