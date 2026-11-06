"use client";
import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ActionResult } from "@/server/action";
import { findMembersAction } from "./actions";

export type Picked = { id: string; name: string; memberNo: string; inHousehold: boolean };

/** Type-ahead search over members. Results come from the server and respect branch access. */
export function MemberPicker({
  onPick,
  exclude = [],
  placeholder = "Search by name, phone or member number",
  autoFocus,
  search: searchFn = findMembersAction,
}: {
  onPick: (m: Picked) => void;
  exclude?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  /** Defaults to the members search; other modules pass a search their roles are allowed to use. */
  search?: (input: { q: string }) => Promise<ActionResult<Picked[]>>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Picked[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const shown = results.filter((r) => !exclude.includes(r.id));

  function search(v: string) {
    setQ(v);
    clearTimeout(t.current);
    if (v.trim().length < 2) {
      setResults([]);
      return;
    }
    t.current = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      const r = await searchFn({ q: v });
      if (mine !== seq.current) return; // a newer search has started
      setLoading(false);
      setResults(r.ok ? r.data : []);
      setActive(0);
    }, 200);
  }
  function pick(m: Picked) {
    onPick(m);
    setQ("");
    setResults([]);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-faint" />
      <input
        type="search"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls="member-picker-list"
        aria-label={placeholder}
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && shown[active]) {
            e.preventDefault();
            pick(shown[active]!);
          }
        }}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 text-[13px] placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-accent-line"
      />
      {q.trim().length >= 2 && (
        <ul
          id="member-picker-list"
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          {shown.length ? (
            shown.map((m, i) => (
              <li
                key={m.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ${i === active ? "bg-surface-2" : ""}`}
              >
                <Avatar name={m.name} size="sm" />
                <span className="flex-1 truncate font-medium">{m.name}</span>
                <span className="font-mono text-xs text-faint">{m.memberNo}</span>
              </li>
            ))
          ) : (
            <li className="px-2 py-2 text-[13px] text-muted">{loading ? "Searching…" : "No one found."}</li>
          )}
        </ul>
      )}
    </div>
  );
}
