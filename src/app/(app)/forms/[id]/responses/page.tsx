import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { listResponses, tally } from "@/server/services/forms";
import { ResponsesView } from "./view";

export const metadata: Metadata = { title: "Responses" };

export default async function ResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireCtx();
  const data = await withOrg(ctx.org.id, async (tx) => {
    try {
      return await listResponses(tx, ctx, id);
    } catch (e) {
      if (e instanceof AppError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  return (
    <ResponsesView
      form={{ id: data.form.id, title: data.form.title, fields: data.form.fields }}
      responses={data.responses}
      tallies={tally(data.form.fields, data.responses)}
    />
  );
}
