import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Cake, CheckCircle2, Circle, HandCoins, Upload, UserPlus } from "lucide-react";
import { count, eq } from "drizzle-orm";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { branches, memberships } from "@/server/db/schema";
import { memberStats } from "@/server/services/members";
import { groupCounts } from "@/server/services/groups";
import { attendanceTrend } from "@/server/services/attendance";
import { followupCounts } from "@/server/services/followup";
import { childStats } from "@/server/services/children";
import { givingSettings, givingSummary } from "@/server/services/giving";
import { formatDate, naira } from "@/lib/format";
import { memoCounts } from "@/server/services/memos";
import { upcomingSchedules } from "@/server/services/schedules";
import { Stat } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Donut, MonthlyBars } from "@/components/charts";
import { fullName } from "@/lib/format";
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
    const [t] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.orgId, ctx.org.id));
    const people = ctx.can("members.read") ? await memberStats(tx, ctx) : null;
    const groups = people ? await groupCounts(tx, ctx) : [];
    const trend = ctx.can("attendance.read") ? await attendanceTrend(tx, ctx, 8) : null;
    const fu = ctx.can("followup.manage") ? await followupCounts(tx, ctx) : null;
    const kids = ctx.can("children.checkin") || ctx.can("children.manage") ? await childStats(tx, ctx) : null;
    const giving = ctx.can("giving.read") ? await givingSummary(tx, ctx) : null;
    const gs = await givingSettings(tx, ctx.org.id);
    const memo = ctx.can("memo.approve") || ctx.can("memo.disburse") ? await memoCounts(tx, ctx) : null;
    const nextService = ctx.can("schedules.read") ? ((await upcomingSchedules(tx, ctx, 1))[0] ?? null) : null;
    return { branches: b!.n, team: t!.n, people, groups, anyMembers: (people?.total ?? 0) > 0, trend, fu, kids, giving, gs, memo, nextService };
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
    { done: stats.anyMembers, label: "Import or add your members", href: "/members", icon: Upload },
    {
      done: !!stats.gs.subaccountCode,
      label: "Set up online giving",
      href: "/giving/settings",
      icon: HandCoins,
    },
  ];
  const first = firstName(ctx.user.name);
  return (
    <>
      <PageHeader title={`${greeting()}, ${first}`} description={`Here is how ${ctx.org.name} is doing.`} />
      {(stats.trend || stats.fu || stats.kids || stats.giving || stats.memo || stats.nextService) && (
        <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          {stats.giving && (
            <Stat
              label="Giving this month"
              value={naira(stats.giving.mtd, { compact: stats.giving.mtd >= 1_000_000_000 })}
              sub={
                stats.giving.prevSamePoint ? (
                  `${stats.giving.mtd >= stats.giving.prevSamePoint ? "+" : ""}${Math.round(((stats.giving.mtd - stats.giving.prevSamePoint) / stats.giving.prevSamePoint) * 100)}% on the same point last month`
                ) : (
                  <Link href="/giving" className="text-accent">
                    Open giving
                  </Link>
                )
              }
            />
          )}
          {stats.memo && (
            <Stat
              label="Memos waiting for you"
              value={(stats.memo.action + stats.memo.pay).toLocaleString("en-NG")}
              tone={stats.memo.action + stats.memo.pay > 0 ? "bad" : undefined}
              sub={
                <Link href="/memos" className="text-accent">
                  {stats.memo.pay ? `${stats.memo.pay} cleared for payment` : "Open E-Memo"}
                </Link>
              }
            />
          )}
          {stats.nextService && (
            <Stat
              label="Next service"
              value={formatDate(stats.nextService.serviceDate, "week")}
              sub={
                <Link href={`/schedules/${stats.nextService.id}`} className="text-accent">
                  {stats.nextService.title}
                  {stats.nextService.currentVersion === 0 ? " (draft)" : ""}
                </Link>
              }
            />
          )}
          {stats.trend && (
            <Stat
              label="Last Sunday"
              value={(stats.trend.at(-1)?.value ?? 0).toLocaleString("en-NG")}
              sub={
                stats.trend.length > 1 ? (
                  `${stats.trend.at(-1)!.value - stats.trend.at(-2)!.value >= 0 ? "+" : ""}${stats.trend.at(-1)!.value - stats.trend.at(-2)!.value} on the week before`
                ) : (
                  <Link href="/attendance" className="text-accent">
                    Record attendance
                  </Link>
                )
              }
            />
          )}
          {stats.fu && (
            <Stat
              label="Waiting for follow-up"
              value={((stats.fu.byStage.new ?? 0) + (stats.fu.byStage.contacted ?? 0)).toLocaleString("en-NG")}
              sub={
                stats.fu.myOverdue ? (
                  <span className="text-bad">{stats.fu.myOverdue} of yours overdue</span>
                ) : (
                  <Link href="/follow-up" className="text-accent">
                    Open the board
                  </Link>
                )
              }
            />
          )}
          {stats.fu && (
            <Stat
              label="Integrated"
              value={(stats.fu.byStage.integrated ?? 0).toLocaleString("en-NG")}
              sub="Settled into church life"
            />
          )}
          {stats.kids && (
            <Stat
              label="Children in church"
              value={stats.kids.here.toLocaleString("en-NG")}
              sub={`${stats.kids.registered.toLocaleString("en-NG")} registered`}
            />
          )}
        </div>
      )}
      {stats.people && <PeopleOverview s={stats.people} groups={stats.groups} />}
      {ctx.can("settings.manage") && steps.some((s) => !s.done) && (
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

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function PeopleOverview({
  s,
  groups,
}: {
  s: NonNullable<Awaited<ReturnType<typeof memberStats>>>;
  groups: { kind: string; n: number }[];
}) {
  const change = s.newThisMonth - s.newLastMonth;
  const g = (k: string) => Number(groups.find((x) => x.kind === k)?.n ?? 0);
  return (
    <>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat
          label="Active people"
          value={s.total.toLocaleString("en-NG")}
          sub={`${s.members.toLocaleString("en-NG")} members and regulars`}
        />
        <Stat
          label="Joined this month"
          value={s.newThisMonth.toLocaleString("en-NG")}
          sub={change === 0 ? "Same as last month" : `${change > 0 ? "+" : ""}${change} on last month`}
          tone={change > 0 ? "good" : undefined}
        />
        <Stat
          label="First timers (30 days)"
          value={s.firstTimers.toLocaleString("en-NG")}
          sub={
            <Link href="/members?stage=first_timer" className="text-accent">
              See them
            </Link>
          }
        />
        <Stat
          label="Groups"
          value={(g("department") + g("cell") + g("ministry")).toLocaleString("en-NG")}
          sub={`${g("department")} departments · ${g("cell")} cells`}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader title="New people, last 12 months" />
          <CardBody>
            <MonthlyBars
              name="Joined"
              data={s.growth.map((m) => ({ label: MONTH_ABBR[Number(m.month.slice(5)) - 1]!, value: m.n }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where people are" />
          <CardBody className="flex flex-col gap-5">
            <Donut
              height={130}
              data={[
                { label: "Members", value: s.stages.member ?? 0, color: "var(--c1)" },
                { label: "Regulars", value: s.stages.regular ?? 0, color: "var(--c3)" },
                { label: "Second timers", value: s.stages.second_timer ?? 0, color: "var(--c2)" },
                { label: "First timers", value: s.stages.first_timer ?? 0, color: "var(--c4)" },
                { label: "Visitors", value: s.stages.visitor ?? 0, color: "var(--c6)" },
              ]}
            />
            <div
              className="flex h-2 overflow-hidden rounded-full bg-surface-3"
              aria-label={`${s.female} women and ${s.male} men`}
            >
              <div className="bg-c2" style={{ width: `${s.total ? (s.female / s.total) * 100 : 50}%` }} />
              <div className="bg-c1" style={{ width: `${s.total ? (s.male / s.total) * 100 : 50}%` }} />
            </div>
            <div className="-mt-3 flex justify-between text-xs text-muted">
              <span>{s.female.toLocaleString("en-NG")} women</span>
              <span>{s.male.toLocaleString("en-NG")} men</span>
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Cake className="size-4 text-c2" /> Birthdays in the next 7 days
            </span>
          }
          action={
            <Link href="/members?birthdays=week" className="text-[13px] text-accent">
              See all
            </Link>
          }
        />
        <CardBody>
          {s.birthdays.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {s.birthdays.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/members/${b.id}`}
                    className="flex items-center gap-2.5 rounded-xl p-1 hover:bg-surface-2"
                  >
                    <Avatar name={fullName(b)} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{fullName(b)}</span>
                      <span className="text-xs text-faint">
                        {b.dobDay} {MONTH_ABBR[(b.dobMonth ?? 1) - 1]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No birthdays this week.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}
