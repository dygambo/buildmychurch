import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { careTeam, getCase, seesConfidential } from "@/server/services/care";
import { CaseDetail } from "./detail";

export const metadata: Metadata = { title: "Care record" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireCtx();
  const data = await withOrg(ctx.org.id, async (tx) => {
    try {
      return { c: await getCase(tx, ctx, id), team: (await careTeam(tx, ctx.org.id)).map((t) => ({ id: t.id, name: t.name })) };
    } catch (e) {
      if (e instanceof AppError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  return <CaseDetail key={data.c.id} c={data.c} team={data.team} pastor={seesConfidential(ctx)} />;
}
