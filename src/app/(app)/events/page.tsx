import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listEvents } from "@/server/services/events";
import { listBranches } from "@/server/services/org";
import { EventsView } from "./view";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const ctx = await requireCtx();
  const { when } = await searchParams;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    events: await listEvents(tx, ctx, { when }),
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
  }));
  return <EventsView events={data.events} when={when === "past" ? "past" : "upcoming"} branches={data.branches.map((b) => ({ id: b.id, name: b.name }))} />;
}
