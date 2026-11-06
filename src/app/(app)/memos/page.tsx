import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listMemos, memoCounts } from "@/server/services/memos";
import { MemosView } from "./view";

export const metadata: Metadata = { title: "E-Memo" };

export default async function MemosPage({ searchParams }: { searchParams: Promise<{ box?: string; status?: string; q?: string; page?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const approver = ctx.can("memo.approve");
  const box = sp.box ?? (approver ? "action" : "mine");
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listMemos(tx, ctx, { box: box === "all" ? undefined : box, status: sp.status, q: sp.q, page: Number(sp.page) || 1 }),
    counts: await memoCounts(tx, ctx),
  }));
  return (
    <MemosView
      {...data}
      box={box}
      status={sp.status ?? ""}
      userId={ctx.user.id}
      can={{ approve: approver, disburse: ctx.can("memo.disburse"), settings: ctx.can("settings.manage") }}
    />
  );
}
