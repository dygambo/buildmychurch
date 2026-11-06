import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { followupTeam, getVisitorLink, listFollowups } from "@/server/services/followup";
import { env } from "@/server/env";
import { NoAccess } from "@/components/no-access";
import { FollowupBoard } from "./view";

export const metadata: Metadata = { title: "Follow-up" };

export default async function FollowupPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; card?: string; open?: string }>;
}) {
  const ctx = await requireCtx();
  if (!ctx.can("followup.manage")) return <NoAccess what="manage follow-up" />;
  const sp = await searchParams;
  const who = sp.who === "me" || sp.who === "none" ? sp.who : undefined;
  const data = await withOrg(ctx.org.id, async (tx) => ({
    list: await listFollowups(tx, ctx, { assignedTo: who }),
    team: await followupTeam(tx, ctx.org.id),
    token: await getVisitorLink(tx, ctx),
  }));
  return (
    <FollowupBoard
      who={who ?? "all"}
      me={ctx.user.id}
      showCard={sp.card === "1"}
      openId={sp.open && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null}
      visitorUrl={`${env().APP_URL}/welcome/${data.token}`}
      team={data.team}
      items={data.list.map((f) => ({
        ...f,
        dueAt: f.dueAt?.toISOString() ?? null,
        lastContactAt: f.lastContactAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
      }))}
    />
  );
}
