import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { attendanceTrend, lagosToday, listServices, listTemplates } from "@/server/services/attendance";
import { listBranches } from "@/server/services/org";
import { NoAccess } from "@/components/no-access";
import { AttendanceView } from "./view";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const ctx = await requireCtx();
  if (!ctx.can("attendance.read") && !ctx.can("attendance.record")) return <NoAccess what="see attendance" />;
  const today = lagosToday();
  const data = await withOrg(ctx.org.id, async (tx) => ({
    services: await listServices(tx, ctx, { limit: 30 }),
    templates: await listTemplates(tx, ctx),
    trend: ctx.can("attendance.read") ? await attendanceTrend(tx, ctx, 12) : [],
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return (
    <AttendanceView
      today={today}
      todayTemplates={data.templates.filter((t) => t.weekday === weekday).length}
      services={data.services.map((s) => ({ ...s, date: String(s.date), startsAt: s.startsAt.toISOString() }))}
      templates={data.templates.map((t) => ({
        ...t,
        startTime: t.startTime.slice(0, 5),
        createdAt: undefined,
        archivedAt: undefined,
      }))}
      trend={data.trend}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      canRecord={ctx.can("attendance.record")}
      canRead={ctx.can("attendance.read")}
    />
  );
}
