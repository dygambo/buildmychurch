import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { checkinRows } from "@/server/services/children";
import { lagosToday } from "@/server/services/attendance";
import { NoAccess } from "@/components/no-access";
import { RecordsView } from "./view";

export const metadata: Metadata = { title: "Children's records" };

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; child?: string }>;
}) {
  const ctx = await requireCtx();
  if (!ctx.can("children.manage")) return <NoAccess what="see children's check-in records" />;
  const sp = await searchParams;
  const to = isDate(sp.to) ? sp.to! : lagosToday();
  const from = isDate(sp.from) ? sp.from! : new Date(Date.parse(to) - 27 * 86400_000).toISOString().slice(0, 10);
  const child = sp.child && /^[0-9a-f-]{36}$/i.test(sp.child) ? sp.child : undefined;
  const rows = await withOrg(ctx.org.id, (tx) => checkinRows(tx, ctx, { from, to, childId: child, limit: 1000 }));
  return (
    <RecordsView
      from={from}
      to={to}
      child={child}
      rows={rows.map((r) => ({
        ...r,
        checkedInAt: r.checkedInAt.toISOString(),
        checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
      }))}
    />
  );
}
