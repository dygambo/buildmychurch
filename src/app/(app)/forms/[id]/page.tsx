import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { getForm } from "@/server/services/forms";
import { FormBuilder } from "./builder";

export const metadata: Metadata = { title: "Form" };

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireCtx();
  const f = await withOrg(ctx.org.id, async (tx) => {
    try {
      return await getForm(tx, ctx, id);
    } catch (e) {
      if (e instanceof AppError) return null;
      throw e;
    }
  });
  if (!f) notFound();
  return <FormBuilder key={f.id} f={f} />;
}
