"use client";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Copy, ExternalLink, HandCoins, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note, Stat } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Donut, StackedBars } from "@/components/charts";
import { QrImage } from "@/components/qr";
import { formatDate, naira } from "@/lib/format";
import type { TxRow } from "@/server/services/giving";
import { CHANNELS, COLOR_VAR } from "./labels";

type Summary = {
  mtd: number;
  prevSamePoint: number;
  prevMonth: number;
  ytd: number;
  onlineMtd: number;
  giversMtd: number;
  byFund: { fundId: string; name: string; color: string; restricted: boolean; mtd: number; prev: number; ytd: number }[];
  byChannel: { channel: string; total: number }[];
  weekly: { week: string; fundId: string; total: number }[];
};
type Campaign = { id: string; name: string; goalKobo: number; raised: number; pledged: number; pledgers: number };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function GivingOverview({
  today,
  summary: s,
  recent,
  pending,
  campaigns,
  givingUrl,
  online,
  can,
}: {
  today: string;
  summary: Summary;
  recent: TxRow[];
  pending: number;
  campaigns: Campaign[];
  givingUrl: string;
  online: "test" | "live" | "off";
  can: { record: boolean; manage: boolean };
}) {
  const change = s.prevSamePoint ? Math.round(((s.mtd - s.prevSamePoint) / s.prevSamePoint) * 100) : null;
  // twelve Sundays, oldest first, so empty weeks still show
  const weeks: string[] = [];
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  for (let i = 11; i >= 0; i--) weeks.push(new Date(t.getTime() - i * 7 * 86400_000).toISOString().slice(0, 10));
  const chart = weeks.map((w) => {
    const row: Record<string, number | string> = { label: formatDate(w, "short") };
    for (const f of s.byFund) row[f.fundId] = s.weekly.find((x) => x.week === w && x.fundId === f.fundId)?.total ?? 0;
    return row;
  });
  const anyGiving = s.ytd > 0 || s.prevMonth > 0 || recent.length > 0;

  return (
    <>
      <PageHeader
        title="Giving"
        description="Tithes, offerings and project gifts, from the counting room and online."
        actions={
          can.record && (
            <Button variant="primary" asChild>
              <Link href="/giving/batches?new=1">
                <Plus /> Count a collection
              </Link>
            </Button>
          )
        }
      />

      {pending > 0 && (
        <Note tone="accent" icon={<ClipboardCheck />}>
          <Link href="/giving/batches?status=submitted" className="font-medium underline-offset-2 hover:underline">
            {pending} collection{pending === 1 ? " is" : "s are"} waiting for you to verify
          </Link>
          . Gifts reach the ledger only after a second person checks the count.
        </Note>
      )}

      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat
          label="This month"
          value={naira(s.mtd)}
          sub={
            change == null
              ? "Nothing at this point last month"
              : `${change >= 0 ? "+" : ""}${change}% on the same point last month`
          }
          tone={change != null && change > 0 ? "good" : undefined}
        />
        <Stat label="Year to date" value={naira(s.ytd, { compact: s.ytd >= 100_000_000_00 })} sub={`Last month: ${naira(s.prevMonth, { compact: true })}`} />
        <Stat label="Given online" value={`${pct(s.onlineMtd, s.mtd)}%`} sub={`${naira(s.onlineMtd, { compact: true })} this month`} />
        <Stat label="Named givers this month" value={s.giversMtd.toLocaleString("en-NG")} sub="Linked to a member record" />
      </div>

      {!anyGiving ? (
        <Card>
          <EmptyState
            icon={<HandCoins />}
            title="No giving recorded yet"
            action={
              can.record && (
                <Button variant="primary" asChild>
                  <Link href="/giving/batches?new=1">
                    <Plus /> Count your first collection
                  </Link>
                </Button>
              )
            }
          >
            Count Sunday&apos;s offering into a batch, have a second person verify it, and it appears here. Online gifts
            appear the moment they&apos;re paid.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-xl:grid-cols-1">
          <Card>
            <CardHeader title="Giving by week, last 12 weeks" />
            <CardBody>
              <StackedBars
                data={chart}
                series={s.byFund.map((f) => ({ key: f.fundId, name: f.name, color: COLOR_VAR[f.color] ?? "var(--c1)" }))}
                format={(v) => naira(v, { compact: true })}
                label={`Weekly giving by fund for the last 12 weeks`}
              />
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {s.byFund.map((f) => (
                  <li key={f.fundId} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: COLOR_VAR[f.color] }} />
                    {f.name}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Funds" action={<span className="text-xs text-faint">This month</span>} />
            <Table>
              <thead>
                <tr>
                  <Th>Fund</Th>
                  <Th num>This month</Th>
                  <Th num className="max-sm:hidden">
                    Last month
                  </Th>
                  <Th num>Year</Th>
                </tr>
              </thead>
              <tbody>
                {s.byFund.map((f) => (
                  <Tr key={f.fundId}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOR_VAR[f.color] }} />
                        <Link href={`/giving/transactions?fund=${f.fundId}`} className="font-medium hover:text-accent">
                          {f.name}
                        </Link>
                        {f.restricted && (
                          <Badge tone="purple" className="max-sm:hidden">
                            Restricted
                          </Badge>
                        )}
                      </span>
                    </Td>
                    <Td num className="font-medium">
                      {naira(f.mtd)}
                    </Td>
                    <Td num className="text-muted max-sm:hidden">
                      {naira(f.prev)}
                    </Td>
                    <Td num>{naira(f.ytd, { compact: true })}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-xl:grid-cols-1">
        <Card>
          <CardHeader
            title="Latest gifts"
            action={
              <Link href="/giving/transactions" className="flex items-center gap-1 text-[13px] text-accent">
                All transactions <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {recent.length ? (
            <Table>
              <tbody>
                {recent.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <div className="font-medium">{r.giver}</div>
                      <div className="text-xs text-faint">
                        {formatDate(r.givenOn, "week")} · {r.fundName} · {CHANNELS[r.channel]}
                      </div>
                    </Td>
                    <Td num className={r.amountKobo < 0 ? "text-bad" : "font-medium"}>
                      {naira(r.amountKobo)}
                      {r.reversed && (
                        <Badge tone="bad" className="ml-2">
                          Reversed
                        </Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody className="text-[13px] text-muted">No gifts yet.</CardBody>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          {s.byChannel.length > 0 && (
            <Card>
              <CardHeader title="How people gave this month" />
              <CardBody>
                <Donut
                  height={120}
                  data={s.byChannel.map((c, i) => ({
                    label: CHANNELS[c.channel] ?? c.channel,
                    value: Math.round(c.total / 100),
                    color: ["var(--c1)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c2)", "var(--c6)"][i % 6]!,
                  }))}
                />
              </CardBody>
            </Card>
          )}
          <OnlineCard url={givingUrl} online={online} manage={can.manage} />
          {campaigns.length > 0 && (
            <Card>
              <CardHeader
                title="Projects"
                action={
                  <Link href="/giving/pledges" className="text-[13px] text-accent">
                    See all
                  </Link>
                }
              />
              <CardBody className="flex flex-col gap-4">
                {campaigns.map((c) => (
                  <Link key={c.id} href={`/giving/pledges/${c.id}`} className="flex flex-col gap-1.5 hover:text-accent">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular text-xs text-muted">{pct(c.raised, c.goalKobo)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-good" style={{ width: `${Math.min(100, pct(c.raised, c.goalKobo))}%` }} />
                    </div>
                    <div className="text-xs text-faint">
                      {naira(c.raised, { compact: true })} of {naira(c.goalKobo, { compact: true })} · {c.pledgers} pledges
                    </div>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function OnlineCard({ url, online, manage }: { url: string; online: "test" | "live" | "off"; manage: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Online giving"
        action={
          <Badge tone={online === "live" ? "good" : online === "test" ? "warn" : "neutral"} dot>
            {online === "live" ? "Live" : online === "test" ? "Test mode" : "Not set up"}
          </Badge>
        }
      />
      <CardBody className="flex items-start gap-4">
        <QrImage value={url} size={96} label="QR code for the giving page" />
        <div className="flex min-w-0 flex-col gap-2 text-[13px]">
          <p className="text-muted">
            {online === "off"
              ? "Choose the bank account gifts should be paid into, and people can give by card, transfer or USSD."
              : "Show this code on screen during the offering. Gifts are receipted and recorded instantly."}
          </p>
          <code className="truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-xs">{url.replace(/^https?:\/\//, "")}</code>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy. Select the link and copy it by hand."),
                )
              }
            >
              <Copy /> Copy link
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink /> Open
              </a>
            </Button>
            {online === "off" && manage && (
              <Button size="sm" variant="soft" asChild>
                <Link href="/giving/settings">
                  <ShieldCheck /> Set up
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
