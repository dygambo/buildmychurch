import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listBranches } from "@/server/services/org";
import { listSchedules, listTemplates, mySchedules, upcomingSchedules, type ScheduleFilters } from "@/server/services/schedules";
import { NoAccess } from "@/components/no-access";
import { SchedulesView } from "./view";

export const metadata: Metadata = { title: "Service schedules" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function SchedulesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireCtx();
  if (!ctx.can("schedules.read")) return <NoAccess what="see service schedules" />;
  const sp = await searchParams;
  const filters: ScheduleFilters = {
    q: one(sp.q),
    from: one(sp.from),
    to: one(sp.to),
    type: one(sp.type),
    status: one(sp.status),
    person: one(sp.person),
    venue: one(sp.venue),
    page: Number(one(sp.page)) || 1,
  };
  const manage = ctx.can("schedules.manage");
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listSchedules(tx, ctx, filters),
    upcoming: await upcomingSchedules(tx, ctx),
    mine: await mySchedules(tx, ctx),
    templates: manage ? (await listTemplates(tx)).map((t) => ({ id: t.id, name: t.name, serviceType: t.serviceType, items: t.body.items.length })) : [],
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <SchedulesView
      {...data}
      filters={filters}
      canManage={manage}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      openNew={one(sp.new) === "1"}
    />
  );
}
