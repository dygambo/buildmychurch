import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { listCategories } from "@/server/services/expenses";
import { listFiles } from "@/server/services/files";
import { listFunds } from "@/server/services/giving";
import { getMemo } from "@/server/services/memos";
import { MemoDetailView } from "./detail";

export const metadata: Metadata = { title: "Memo" };

export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  let data;
  try {
    data = await withOrg(ctx.org.id, async (tx) => {
      const m = await getMemo(tx, ctx, id);
      return {
        m,
        files: await listFiles(tx, "memo", id),
        categories: m.canDisburse ? await listCategories(tx) : [],
        funds: m.canDisburse ? await listFunds(tx) : [],
      };
    });
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  return (
    <MemoDetailView
      m={data.m}
      files={data.files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
      categories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name }))}
      church={ctx.org.name}
      canSeeMembers={ctx.can("members.read")}
    />
  );
}
