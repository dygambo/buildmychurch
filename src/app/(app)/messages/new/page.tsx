import type { Metadata } from "next";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { members, users } from "@/server/db/schema";
import { env } from "@/server/env";
import { whatsappEnabled } from "@/server/providers/messaging";
import { listGroups } from "@/server/services/groups";
import { listTags } from "@/server/services/members";
import { listTemplates, smsBalance } from "@/server/services/messaging";
import { listBranches } from "@/server/services/org";
import { NoAccess } from "@/components/no-access";
import { Composer } from "./composer";

export const metadata: Metadata = { title: "New message" };

export default async function NewMessagePage({ searchParams }: { searchParams: Promise<{ channel?: string; to?: string; template?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("messaging.send")) return <NoAccess what="send messages" />;
  const sp = await searchParams;
  const wa = whatsappEnabled();
  const channel = sp.channel === "email" ? "email" : sp.channel === "whatsapp" && wa ? "whatsapp" : "sms";
  const toIds = (sp.to ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  const data = await withOrg(ctx.org.id, async (tx) => ({
    branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
    groups: await listGroups(tx, ctx),
    tags: await listTags(tx),
    templates: await listTemplates(tx),
    balance: await smsBalance(tx),
    people: toIds.length
      ? await tx
          .select({ id: members.id, firstName: members.firstName, lastName: members.lastName })
          .from(members)
          .where(and(inArray(members.id, toIds), isNull(members.deletedAt)))
      : [],
    me: (await tx.select({ phone: users.phone }).from(users).where(eq(users.id, ctx.user.id)))[0],
  }));
  return (
    <Composer
      key={channel}
      channel={channel}
      church={ctx.org.name}
      whatsapp={wa}
      balance={data.balance}
      unitPriceKobo={env().SMS_UNIT_PRICE_KOBO}
      canBuy={ctx.can("messaging.manage")}
      hasPhone={!!data.me?.phone}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      groups={data.groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind }))}
      tags={data.tags.map((t) => ({ id: t.id, name: t.name }))}
      templates={data.templates
        .filter((t) => t.channel === channel || (channel === "whatsapp" && t.channel === "sms"))
        .map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body }))}
      initialTemplate={sp.template}
      initialPeople={data.people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))}
    />
  );
}
