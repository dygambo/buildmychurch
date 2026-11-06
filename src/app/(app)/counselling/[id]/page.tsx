import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { listBranches } from "@/server/services/org";
import { counsellors, getCase, oversees } from "@/server/services/counselling";
import { CaseDetailView } from "./detail";

export const metadata: Metadata = { title: "Counselling" };

export default async function CounsellingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireCtx();
  const now = new Date().getTime();
  const data = await withOrg(ctx.org.id, async (tx) => {
    try {
      return {
        c: await getCase(tx, ctx, id),
        team: (await counsellors(tx, ctx.org.id)).map((t) => ({ id: t.id, name: t.name })),
        branches: (await listBranches(tx)).map((b) => ({ id: b.id, name: b.name })),
      };
    } catch (e) {
      if (e instanceof AppError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  return <CaseDetailView key={data.c.id} {...data} canOversee={oversees(ctx)} me={ctx.user.id} now={now} />;
}
