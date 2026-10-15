"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Menu, Moon, Sun, LogOut, ChevronsUpDown, Check } from "lucide-react";
import { Logo } from "@/components/brand";
import { Avatar } from "@/components/ui/avatar";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { ICONS } from "./icons";
import type { NavGroup } from "./nav";

type Props = {
  nav: NavGroup[];
  badges: Record<string, { count: number; tone?: "accent" | "bad" }>;
  user: { name: string; email: string; role: string };
  org: { id: string; name: string; plan: string };
  orgs: { id: string; name: string; role: string }[];
  switchOrg: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
  children: React.ReactNode;
};

const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
};

function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
  return (
    <button
      type="button"
      className="grid size-10 place-items-center rounded-[10px] text-white/85 hover:bg-white/15 hover:text-white"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("bmc-theme", next ? "dark" : "light");
        } catch {}
      }}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

export function AppShell({ nav, badges, user, org, orgs, switchOrg, signOut, children }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    // close the mobile menu after navigating
    setLastPath(path);
    setOpen(false);
  }
  const active = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <div className="grid h-dvh grid-cols-[64px_240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]">
      {open && (
        <div className="fixed inset-0 z-40 bg-[var(--overlay)] lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
      <aside
        className={cn(
          "z-50 flex flex-col items-center gap-1.5 bg-rail py-3.5 text-white max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-16 max-lg:transition-transform",
          !open && "max-lg:-translate-x-full",
        )}
      >
        <Link href="/dashboard" className="mb-3" aria-label="Dashboard">
          <Logo className="size-[38px]" />
        </Link>
        <div className="flex-1" />
        <ThemeToggle />
      </aside>
      <nav
        aria-label="Main"
        className={cn(
          "z-50 flex min-h-0 flex-col border-r border-line bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:left-16 max-lg:w-[min(260px,calc(100%-64px))] max-lg:transition-transform",
          !open && "max-lg:-translate-x-[calc(100%+64px)]",
        )}
      >
        <Dropdown>
          <DropdownTrigger className="flex items-center gap-2.5 border-b border-line px-4 pt-4 pb-3.5 text-left hover:bg-surface-2">
            <div className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-accent-soft text-xs font-bold text-accent">
              {org.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-[13.5px] leading-tight">{org.name}</b>
              <small className="text-xs text-faint capitalize">{org.plan} plan</small>
            </div>
            <ChevronsUpDown className="size-4 text-faint" />
          </DropdownTrigger>
          <DropdownContent align="start" className="w-64">
            <DropdownLabel>Your churches</DropdownLabel>
            {orgs.map((o) => (
              <DropdownItem key={o.id} onSelect={() => o.id !== org.id && switchOrg(o.id)}>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.id === org.id && <Check />}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-4">
          {nav.map((g) => (
            <div key={g.label} className="mt-3">
              <h6 className="mb-1 px-2.5 text-[11px] font-semibold tracking-[.06em] text-faint uppercase">{g.label}</h6>
              {g.items.map((it) => {
                const Icon = ICONS[it.icon] ?? ICONS.dashboard!;
                const on = active(it.href);
                const b = badges[it.href];
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg",
                      on &&
                        "bg-accent-soft text-accent before:absolute before:top-[7px] before:bottom-[7px] before:-left-2.5 before:w-[3px] before:rounded-r before:bg-accent",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" />
                    <span className="truncate">{it.label}</span>
                    {b && b.count > 0 && (
                      <span
                        className={cn(
                          "ml-auto rounded-full px-1.5 text-[11px] leading-5 font-semibold",
                          b.tone === "bad" ? "bg-bad-soft text-bad" : "bg-accent text-accent-ink",
                        )}
                      >
                        {b.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <Dropdown>
          <DropdownTrigger className="flex items-center gap-2.5 border-t border-line px-4 py-3 text-left hover:bg-surface-2">
            <Avatar name={user.name} />
            <div className="min-w-0 flex-1">
              <b className="block truncate text-[13px]">{user.name}</b>
              <small className="block truncate text-[11.5px] font-medium text-warn">{user.role}</small>
            </div>
          </DropdownTrigger>
          <DropdownContent align="start" className="w-60">
            <DropdownLabel>{user.email}</DropdownLabel>
            <DropdownItem asChild>
              <Link href="/settings/account">Account and security</Link>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem danger onSelect={() => signOut()}>
              <LogOut /> Sign out
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-lg hover:bg-surface-2"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <span className="truncate font-semibold">{org.name}</span>
        </div>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-12 max-sm:px-4 max-sm:pt-4">
          <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
