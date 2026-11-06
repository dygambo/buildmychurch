import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { getEvent, listRegistrations } from "@/server/services/events";
import { listBranches } from "@/server/services/org";
import { EventDetail } from "./detail";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  let data;
  try {
    data = await withOrg(ctx.org.id, async (tx) => ({
      e: await getEvent(tx, ctx, id),
      regs: await listRegistrations(tx, ctx, id, { q: sp.q, status: sp.status }),
      branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
    }));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  return <EventDetail e={data.e} regs={data.regs} branches={data.branches.map((b) => ({ id: b.id, name: b.name }))} status={sp.status ?? ""} />;
}
