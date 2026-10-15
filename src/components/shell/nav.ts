import type { Permission } from "@/server/auth/permissions";

export type NavItem = { href: string; label: string; icon: string; perm?: Permission | Permission[] };
export type NavGroup = { label: string; items: NavItem[] };

/** Sidebar structure. Items are hidden when the user lacks every listed permission. */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/reports", label: "Reports", icon: "chart", perm: "reports.read" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/members", label: "Members", icon: "users", perm: "members.read" },
      { href: "/children", label: "Children", icon: "child", perm: ["children.checkin", "children.manage"] },
      { href: "/follow-up", label: "Follow-up", icon: "route", perm: "followup.manage" },
      { href: "/groups", label: "Groups & cells", icon: "groups", perm: ["groups.manage", "members.read"] },
      { href: "/care", label: "Prayer & care", icon: "heart", perm: "care.manage" },
    ],
  },
  {
    label: "Services",
    items: [
      { href: "/schedules", label: "Service schedules", icon: "schedule", perm: "schedules.read" },
      { href: "/attendance", label: "Attendance", icon: "calendar", perm: ["attendance.read", "attendance.record"] },
      { href: "/events", label: "Events", icon: "ticket", perm: "events.manage" },
      { href: "/rota", label: "Volunteer rota", icon: "clipboard", perm: "volunteers.manage" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/giving", label: "Giving", icon: "wallet", perm: ["giving.read", "giving.record"] },
      { href: "/expenses", label: "Expenses & accounts", icon: "ledger", perm: "finance.expenses" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/memos", label: "E-Memo", icon: "memo", perm: "memo.create" },
      { href: "/messages", label: "Messaging", icon: "message", perm: "messaging.send" },
      { href: "/forms", label: "Forms", icon: "form", perm: "forms.manage" },
      { href: "/branches", label: "Branches", icon: "building", perm: "branches.manage" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

export function visibleNav(can: (p: Permission) => boolean): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.perm || (Array.isArray(i.perm) ? i.perm.some(can) : can(i.perm))),
  })).filter((g) => g.items.length);
}
