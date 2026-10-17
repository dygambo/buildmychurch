import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { inChurchNow } from "@/server/services/children";
import { todaysServiceOptions } from "@/server/services/attendance";
import { NoAccess } from "@/components/no-access";
import { Desk } from "./desk";

export const metadata: Metadata = { title: "Children's check-in" };

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("children.checkin")) return <NoAccess what="check children in and out" />;
  const sp = await searchParams;
  const { here, servicesToday } = await withOrg(ctx.org.id, async (tx) => ({
    here: await inChurchNow(tx, ctx),
    servicesToday: await todaysServiceOptions(tx, ctx),
  }));
  return (
    <Desk
      church={ctx.org.name}
      here={here.map((h) => ({ ...h, checkedInAt: h.checkedInAt.toISOString() }))}
      services={servicesToday.map((s) => ({ id: s.id, name: s.name }))}
      initialChild={sp.child && /^[0-9a-f-]{36}$/i.test(sp.child) ? sp.child : null}
      canOverride={ctx.can("children.manage")}
    />
  );
}
