import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listBatches } from "@/server/services/giving";
import { todaysServiceOptions } from "@/server/services/attendance";
import { listBranches } from "@/server/services/org";
import { todayISO } from "@/lib/format";
import { BatchesView } from "./view";

export const metadata: Metadata = { title: "Collections" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function BatchesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const status = one(sp.status);
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listBatches(tx, ctx, { status, page: Number(one(sp.page)) || 1 }),
    services: await todaysServiceOptions(tx, ctx),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return (
    <BatchesView
      list={{
        ...data.list,
        rows: data.list.rows.map((r) => ({
          ...r,
          givenOn: String(r.givenOn),
          submittedAt: r.submittedAt?.toISOString() ?? null,
          mine: r.countedBy === ctx.user.id,
        })),
      }}
      status={status ?? ""}
      today={todayISO()}
      services={data.services.map((s) => ({ id: s.id, name: s.name }))}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      openNew={one(sp.new) === "1"}
      can={{ record: ctx.can("giving.record"), verify: ctx.can("giving.verify") }}
    />
  );
}
