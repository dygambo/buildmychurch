import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { rotaGroups, rotaRange, sundays } from "@/server/services/rota";
import { NoAccess } from "@/components/no-access";
import { todayISO } from "@/lib/format";
import { RotaView } from "./view";

export const metadata: Metadata = { title: "Volunteer rota" };

export default async function RotaPage({ searchParams }: { searchParams: Promise<{ from?: string; group?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("volunteers.manage")) return <NoAccess what="manage the volunteer rota" />;
  const sp = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : todayISO();
  const dates = sundays(from, 4);
  const data = await withOrg(ctx.org.id, async (tx) => ({
    groups: await rotaGroups(tx, ctx),
    slots: await rotaRange(tx, ctx, { from: dates[0]!, to: dates[3]!, groupId: sp.group }),
  }));
  return <RotaView dates={dates} groups={data.groups} slots={data.slots} groupId={sp.group ?? ""} />;
}
