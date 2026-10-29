import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { getEvent } from "@/server/services/events";
import { CheckinDesk } from "./desk";

export const metadata: Metadata = { title: "Event check-in" };

export default async function CheckinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  let e;
  try {
    e = await withOrg(ctx.org.id, (tx) => getEvent(tx, ctx, id));
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  return (
    <CheckinDesk
      e={{
        id: e.id,
        title: e.title,
        types: e.types.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name, priceKobo: t.priceKobo })),
        sold: e.types.reduce((s, t) => s + t.sold, 0),
        inside: e.types.reduce((s, t) => s + t.inside, 0),
      }}
    />
  );
}
