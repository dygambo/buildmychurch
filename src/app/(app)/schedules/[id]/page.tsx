import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { listBranches } from "@/server/services/org";
import { getSchedule, listNotifications } from "@/server/services/schedules";
import { NoAccess } from "@/components/no-access";
import { ScheduleEditor } from "./editor";
import { ScheduleHistory } from "./history";
import { ScheduleViewer } from "./viewer";

export const metadata: Metadata = { title: "Service schedule" };

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.can("schedules.read")) return <NoAccess what="see service schedules" />;
  let data;
  try {
    data = await withOrg(ctx.org.id, async (tx) => {
      const s = await getSchedule(tx, ctx, id);
      return {
        s,
        notifications: s.canManage ? await listNotifications(tx, ctx, id) : [],
        branches: s.canManage ? (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)) : [],
      };
    });
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { s } = data;
  if (!s.canManage) return <ScheduleViewer s={s} />;
  if (tab === "history")
    return <ScheduleHistory s={{ id: s.id, title: s.title, currentVersion: s.currentVersion, versions: s.versions }} notifications={data.notifications} />;
  return (
    <ScheduleEditor
      key={s.id}
      s={{
        ...s,
        updatedAt: s.updatedAt.toISOString(),
        lastPublishedAt: s.lastPublishedAt?.toISOString() ?? null,
        items: s.items.map((i) => ({
          title: i.title,
          startTime: i.startTime,
          durationMin: i.durationMin,
          description: i.description,
          notes: i.notes,
          custom: i.custom,
          assignees: i.assignees.map((a) => ({ memberId: a.memberId, userId: a.userId, groupId: a.groupId, name: a.name, responsibility: a.responsibility })),
        })),
      }}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      failed={data.notifications.filter((n) => n.status === "failed").length}
      church={ctx.org.name}
    />
  );
}
