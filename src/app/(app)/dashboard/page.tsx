import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CheckCircle2, Circle, HandCoins, Upload, UserPlus } from "lucide-react";
import { count, eq, sql } from "drizzle-orm";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { branches, members, memberships } from "@/server/db/schema";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { firstName } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(new Date()),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const stats = await withOrg(ctx.org.id, async (tx) => {
    const [b] = await tx.select({ n: count() }).from(branches);
    const [m] = await tx
      .select({ n: count() })
      .from(members)
      .where(sql`${members.deletedAt} is null`);
    const [t] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.orgId, ctx.org.id));
    return { branches: b!.n, members: m!.n, team: t!.n };
  });
  const steps = [
    {
      done: ctx.user.mfaEnabled,
      label: "Turn on two-step verification",
      href: "/settings/account",
      icon: CheckCircle2,
    },
    { done: stats.branches > 1, label: "Add your branches", href: "/branches", icon: Building2 },
    { done: stats.team > 1, label: "Invite your team", href: "/settings/team", icon: UserPlus },
    { done: stats.members > 0, label: "Import or add your members", href: "/members", icon: Upload },
    { done: false, label: "Set up online giving", href: "/giving", icon: HandCoins },
  ];
  const first = firstName(ctx.user.name);
  return (
    <>
      <PageHeader title={`${greeting()}, ${first}`} description={`Here is how ${ctx.org.name} is doing.`} />
      {ctx.can("settings.manage") && (
        <Card>
          <CardHeader
            title="Get your church set up"
            action={
              <span className="text-xs text-faint">
                {steps.filter((s) => s.done).length} of {steps.length} done
              </span>
            }
          />
          <CardBody className="flex flex-col divide-y divide-line">
            {steps.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:text-accent"
              >
                {s.done ? <CheckCircle2 className="size-5 text-good" /> : <Circle className="size-5 text-faint" />}
                <span className={s.done ? "text-muted line-through" : "font-medium"}>{s.label}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}
    </>
  );
}
