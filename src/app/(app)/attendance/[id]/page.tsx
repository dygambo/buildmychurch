import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getService } from "@/server/services/attendance";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { NoAccess } from "@/components/no-access";
import { ServiceDesk } from "./view";

export const metadata: Metadata = { title: "Service" };

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("attendance.read") && !ctx.can("attendance.record")) return <NoAccess what="see attendance" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let s;
  try {
    s = await withOrg(ctx.org.id, (tx) => getService(tx, ctx, id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  return (
    <ServiceDesk
      service={{
        id: s.id,
        name: s.name,
        date: String(s.date),
        startsAt: s.startsAt.toISOString(),
        status: s.status,
        branchName: s.branchName,
        men: s.men,
        women: s.women,
        children: s.children,
        online: s.online,
        firstTimersCount: s.firstTimersCount,
        countNotes: s.countNotes,
        headcount: s.headcount,
      }}
      present={s.present.map((p) => ({ ...p, at: p.at.toISOString() }))}
      checkinUrl={s.checkinToken ? `${env().APP_URL}/c/${s.checkinToken}` : null}
      canRecord={ctx.can("attendance.record")}
    />
  );
}
