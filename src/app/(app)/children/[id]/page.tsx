import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getChild } from "@/server/services/children";
import { listBranches } from "@/server/services/org";
import { AppError } from "@/server/errors";
import { ChildProfile } from "./view";

export const metadata: Metadata = { title: "Child" };

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    data = await withOrg(ctx.org.id, async (tx) => ({
      c: await getChild(tx, ctx, id),
      branches: await listBranches(tx),
    }));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { c, branches } = data;
  return (
    <ChildProfile
      child={{
        ...c,
        open: c.open ? { ...c.open, checkedInAt: c.open.checkedInAt.toISOString() } : null,
        recent: c.recent.map((r) => ({
          ...r,
          checkedInAt: r.checkedInAt.toISOString(),
          checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
        })),
      }}
      church={ctx.org.name}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={ctx.can("children.manage")}
      canMedical={ctx.can("children.read_medical")}
    />
  );
}
