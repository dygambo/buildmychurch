"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { Donut, MonthlyBars, StackedBars } from "@/components/charts";
import { formatDate, naira, num } from "@/lib/format";
import { PRESETS, type Period } from "@/lib/periods";
import { cn } from "@/lib/utils";
import type { attendanceReport, branchComparison, financeReport, givingReport, growth, overview } from "@/server/services/reports";

type R<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

const TAB_LABEL: Record<string, string> = { overview: "Overview", growth: "Growth", attendance: "Attendance", giving: "Giving", finance: "Income & spending", branches: "Branches" };
const KIND_LABEL: Record<string, string> = { sunday: "Sunday service", midweek: "Midweek service", special: "Special service", vigil: "Vigil", youth: "Youth service", children: "Children's church", other: "Other" };
const compactNaira = (v: number) => naira(v * 100, { compact: true });

export function ReportsView({
  period,
  branches,
  branchId,
  tabs,
  tab,
  kpis,
  growth: g,
  attendance: a,
  giving: gv,
  finance: f,
  compare,
}: {
  period: Period;
  branches: { id: string; name: string }[];
  branchId: string | null;
  tabs: string[];
  tab: string;
  kpis: R<typeof overview>;
  growth: R<typeof growth> | null;
  attendance: R<typeof attendanceReport> | null;
  giving: R<typeof givingReport> | null;
  finance: R<typeof financeReport> | null;
  compare: R<typeof branchComparison> | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const keep = (t: string) => {
    const next = new URLSearchParams(sp.toString());
    if (t === "overview") next.delete("tab");
    else next.set("tab", t);
    return `${path}?${next}`;
  };
  const exportHref = `/reports/export?${new URLSearchParams({ period: period.preset, from: period.from, to: period.to, ...(branchId ? { branch: branchId } : {}) })}`;
  return (
    <>
      <PageHeader
        title="Reports"
        description={`${period.label}: ${formatDate(period.from)} to ${formatDate(period.to)}${branchId ? ` · ${branches.find((b) => b.id === branchId)?.name}` : branches.length > 1 ? " · all branches" : ""}`}
        actions={
          <Button asChild>
            <a href={exportHref}>
              <Download /> Excel
            </a>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Period" value={period.preset} onChange={(e) => set({ period: e.target.value, ...(e.target.value === "custom" ? { from, to } : { from: "", to: "" }) })} className="w-44">
          {Object.entries(PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        {period.preset === "custom" && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              set({ period: "custom", from, to });
            }}
          >
            <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <span className="text-xs text-faint">to</span>
            <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            <Button type="submit" size="sm">
              Show
            </Button>
          </form>
        )}
        {branches.length > 1 && (
          <Select aria-label="Branch" value={branchId ?? ""} onChange={(e) => set({ branch: e.target.value, tab: tab === "branches" ? "" : sp.get("tab") ?? "" })} className="w-48">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2" data-testid="kpis">
        <Kpi label="Average Sunday attendance" value={num(kpis.avgAttendance)} delta={kpis.attendanceChange} />
        <Kpi label="First timers" value={num(kpis.firstTimers)} delta={kpis.firstTimersChange} sub={kpis.retentionRate !== null ? `${kpis.retentionRate}% now regulars or members` : undefined} />
        <Kpi label="New people" value={num(kpis.joined)} delta={kpis.joinedChange} sub={`${num(kpis.members)} members, ${num(kpis.people)} people in all`} />
        {kpis.giving ? (
          <Kpi
            label="Giving"
            value={naira(kpis.giving.total, { compact: true })}
            delta={kpis.giving.prev ? Math.round(((kpis.giving.total - kpis.giving.prev) / kpis.giving.prev) * 100) : null}
            sub={kpis.giving.digitalShare !== null ? `${kpis.giving.digitalShare}% given digitally` : undefined}
          />
        ) : (
          <Kpi label="In a department or cell" value={kpis.engagement !== null ? `${kpis.engagement}%` : "—"} sub="Of members and regulars" />
        )}
      </div>
      <LinkTabs className="self-start" current={tab} tabs={tabs.map((t) => ({ key: t, label: TAB_LABEL[t]!, href: keep(t) }))} />

      {tab === "overview" && g && a && (
        <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          <Card>
            <CardHeader title="Sunday attendance" action={<span className="text-xs text-faint">Average per Sunday, by {period.bucket}</span>} />
            <CardBody>
              <StackedBars
                data={a.series}
                series={[
                  { key: "inPerson", name: "In church", color: "var(--c1)" },
                  { key: "online", name: "Online", color: "var(--c3)" },
                ]}
                label="Average Sunday attendance"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="First timers and new people" />
            <CardBody>
              <StackedBars
                data={g.series}
                grouped
                series={[
                  { key: "firstTimers", name: "First timers", color: "var(--c2)" },
                  { key: "joined", name: "New people on record", color: "var(--c1)" },
                ]}
                label="First timers and new people"
              />
            </CardBody>
          </Card>
          <Funnel f={g.funnel} />
          <Card>
            <CardHeader title="Health of the church" />
            <CardBody className="grid grid-cols-2 gap-3 text-[13px]">
              <Measure label="Members and regulars in a department or cell" value={kpis.engagement} hint="Aim for 60% or more. People who serve stay." />
              <Measure label="First timers who came back" value={kpis.returnRate} hint="A second visit within three months." />
              <Measure label="First timers now regulars or members" value={kpis.retentionRate} hint="Within three months of their first visit." />
              {kpis.giving && <Measure label="Giving received digitally" value={kpis.giving.digitalShare} hint="Online, transfer and POS. Less cash to count and carry." />}
            </CardBody>
          </Card>
          {gv && gv.total > 0 && (
            <Card className="col-span-full">
              <CardHeader title="Giving by fund" />
              <CardBody>
                <StackedBars data={gv.chart} series={gv.series} label="Giving by fund" format={compactNaira} />
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === "growth" && g && (
        <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          <Card className="col-span-full">
            <CardHeader title="First timers and new people" />
            <CardBody>
              <StackedBars
                data={g.series}
                grouped
                series={[
                  { key: "firstTimers", name: "First timers", color: "var(--c2)" },
                  { key: "joined", name: "New people on record", color: "var(--c1)" },
                ]}
                label="First timers and new people"
              />
            </CardBody>
          </Card>
          <Funnel f={g.funnel} />
          <Card>
            <CardHeader title="Where people are" />
            <CardBody>
              <Donut data={g.stages} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Age" />
            <CardBody>
              <MonthlyBars data={g.ages} name="People" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Men and women" />
            <CardBody className="flex flex-col gap-6">
              <Donut data={g.genders} height={140} />
              {g.areas.length > 0 && (
                <div>
                  <div className="mb-2 text-[13px] font-medium">Top areas</div>
                  <Bars rows={g.areas} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "attendance" && a && (
        <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          <Card className="col-span-full">
            <CardHeader title="Average Sunday attendance" />
            <CardBody>
              <StackedBars
                data={a.series}
                series={[
                  { key: "inPerson", name: "In church", color: "var(--c1)" },
                  { key: "online", name: "Online", color: "var(--c3)" },
                ]}
                label="Average Sunday attendance"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By service" />
            {a.byKind.length === 0 ? (
              <EmptyState title="No counts yet">Record headcounts in Attendance after each service.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Service</Th>
                    <Th num>Services</Th>
                    <Th num>Average</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.byKind.map((k) => (
                    <Tr key={k.kind}>
                      <Td>{KIND_LABEL[k.kind] ?? k.kind}</Td>
                      <Td num>{k.services}</Td>
                      <Td num className="font-medium">
                        {num(k.average)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Who came" />
            <CardBody className="flex flex-col gap-4">
              <Donut data={a.split} height={140} />
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                {a.best && <Measure label="Highest Sunday" raw={`${num(a.best.total)} · ${formatDate(a.best.date, "short")}`} />}
                {a.lowest && <Measure label="Lowest Sunday" raw={`${num(a.lowest.total)} · ${formatDate(a.lowest.date, "short")}`} />}
              </div>
            </CardBody>
          </Card>
          <Card className="col-span-full">
            <CardHeader title="Every service" />
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Service</Th>
                  {branches.length > 1 && <Th className="max-md:hidden">Branch</Th>}
                  <Th num className="max-sm:hidden">
                    Men
                  </Th>
                  <Th num className="max-sm:hidden">
                    Women
                  </Th>
                  <Th num className="max-sm:hidden">
                    Children
                  </Th>
                  <Th num>Total</Th>
                  <Th num className="max-md:hidden">
                    Online
                  </Th>
                </tr>
              </thead>
              <tbody>
                {[...a.services].reverse().map((s, i) => (
                  <Tr key={i}>
                    <Td className="whitespace-nowrap">{formatDate(s.date, "week")}</Td>
                    <Td>{s.name}</Td>
                    {branches.length > 1 && <Td className="max-md:hidden">{s.branch}</Td>}
                    <Td num className="max-sm:hidden">
                      {s.men ?? "—"}
                    </Td>
                    <Td num className="max-sm:hidden">
                      {s.women ?? "—"}
                    </Td>
                    <Td num className="max-sm:hidden">
                      {s.children ?? "—"}
                    </Td>
                    <Td num className="font-medium">
                      {s.total ? num(s.total) : "—"}
                    </Td>
                    <Td num className="max-md:hidden">
                      {s.online ?? "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {tab === "giving" && gv && (
        <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          <Card className="col-span-full">
            <CardHeader title="Giving by fund" action={<span className="text-sm font-semibold">{naira(gv.total)}</span>} />
            <CardBody>
              <StackedBars data={gv.chart} series={gv.series} label="Giving by fund" format={compactNaira} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Funds" />
            <Table>
              <thead>
                <tr>
                  <Th>Fund</Th>
                  <Th num>Total</Th>
                  <Th num className="max-sm:hidden">
                    Share
                  </Th>
                  <Th num>vs before</Th>
                </tr>
              </thead>
              <tbody>
                {gv.funds.map((x) => (
                  <Tr key={x.name}>
                    <Td>{x.name}</Td>
                    <Td num className="font-medium">
                      {naira(x.total)}
                    </Td>
                    <Td num className="max-sm:hidden">
                      {x.share}%
                    </Td>
                    <Td num>
                      <Delta v={x.change} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="How people gave" />
            <CardBody className="flex flex-col gap-4">
              <Donut data={gv.channels} />
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <Measure label="Named givers" raw={num(gv.namedGivers)} />
                <Measure label="Gifts recorded" raw={num(gv.gifts)} />
                <Measure label="Online gifts" raw={num(gv.onlineGifts)} />
                <Measure label="Payment fees" raw={naira(gv.feesKobo)} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "finance" && f && (
        <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          <div className="col-span-full grid grid-cols-3 gap-3 max-sm:grid-cols-1">
            <Kpi label="Money in (giving)" value={naira(f.totalIn)} />
            <Kpi label="Money out (paid expenses)" value={naira(f.totalOut)} />
            <Kpi label={f.net >= 0 ? "Surplus" : "Shortfall"} value={naira(Math.abs(f.net))} tone={f.net >= 0 ? "good" : "bad"} sub={f.welfare ? `Welfare given: ${naira(f.welfare)}` : undefined} />
          </div>
          <Card className="col-span-full">
            <CardHeader title="Income and spending" />
            <CardBody>
              <StackedBars
                data={f.chart}
                grouped
                series={[
                  { key: "income", name: "Income", color: "var(--c3)" },
                  { key: "spending", name: "Spending", color: "var(--c2)" },
                ]}
                label="Income and spending"
                format={compactNaira}
              />
            </CardBody>
          </Card>
          <Card className="col-span-full">
            <CardHeader title="Spending by category" />
            {f.categories.length === 0 ? (
              <EmptyState title="No paid expenses in this period" />
            ) : (
              <CardBody>
                <Bars rows={f.categories.map((c) => ({ label: c.name, value: c.total, display: `${naira(c.total)} · ${c.share}%` }))} />
              </CardBody>
            )}
          </Card>
        </div>
      )}

      {tab === "branches" && compare && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th num>Members</Th>
                <Th num>Avg Sunday</Th>
                <Th num className="max-md:hidden">
                  First timers
                </Th>
                <Th num className="max-md:hidden">
                  Retention
                </Th>
                <Th num className="max-lg:hidden">
                  In a group
                </Th>
                {compare.some((x) => x.giving !== null) && <Th num>Giving</Th>}
                {compare.some((x) => x.spending !== null) && (
                  <Th num className="max-sm:hidden">
                    Spending
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {compare.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <button type="button" className="font-medium hover:text-accent" onClick={() => set({ branch: b.id, tab: "" })}>
                      {b.name}
                    </button>
                  </Td>
                  <Td num>{num(b.members)}</Td>
                  <Td num>{num(b.avgAttendance)}</Td>
                  <Td num className="max-md:hidden">
                    {num(b.firstTimers)}
                  </Td>
                  <Td num className="max-md:hidden">
                    {b.retentionRate !== null ? `${b.retentionRate}%` : "—"}
                  </Td>
                  <Td num className="max-lg:hidden">
                    {b.engagement !== null ? `${b.engagement}%` : "—"}
                  </Td>
                  {b.giving !== null && <Td num>{naira(b.giving, { compact: true })}</Td>}
                  {b.spending !== null && (
                    <Td num className="max-sm:hidden">
                      {naira(b.spending, { compact: true })}
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function Kpi({ label, value, delta, sub, tone }: { label: string; value: string; delta?: number | null; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className={cn("tabular text-xl font-semibold", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</span>
        {delta !== undefined && <Delta v={delta} />}
      </div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs text-faint">—</span>;
  const up = v >= 0;
  return (
    <span className={cn("inline-flex items-center text-xs font-medium tabular", up ? "text-good" : "text-bad")} title="Compared with the period before">
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(v)}%
    </span>
  );
}

function Measure({ label, value, raw, hint }: { label: string; value?: number | null; raw?: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="flex items-start gap-1 text-xs text-muted">
        {label}
        {hint && (
          <span title={hint} className="text-faint">
            <Info className="size-3" />
          </span>
        )}
      </div>
      <div className="tabular text-lg font-semibold">{raw ?? (value === null || value === undefined ? "—" : `${value}%`)}</div>
    </div>
  );
}

function Funnel({ f }: { f: { firstTimers: number; cameBack: number; stayed: number } }) {
  const steps = [
    { label: "First timers", n: f.firstTimers },
    { label: "Came back", n: f.cameBack },
    { label: "Regulars or members now", n: f.stayed },
  ];
  return (
    <Card>
      <CardHeader title="From first timer to member" action={<span className="text-xs text-faint">First timers in this period</span>} />
      <CardBody className="flex flex-col gap-2" data-testid="funnel">
        {f.firstTimers === 0 ? (
          <p className="text-[13px] text-muted">No first timers in this period. Visitor cards and the follow-up board feed this.</p>
        ) : (
          steps.map((s) => (
            <div key={s.label} className="flex items-center gap-3 text-[13px]">
              <span className="w-44 shrink-0 text-muted">{s.label}</span>
              <span className="h-6 flex-1 overflow-hidden rounded-md bg-surface-2">
                <span className="flex h-full items-center rounded-md bg-accent px-2 text-xs font-semibold text-accent-ink" style={{ width: `${Math.max(8, (s.n / f.firstTimers) * 100)}%` }}>
                  {s.n}
                </span>
              </span>
              <span className="w-10 text-right text-xs tabular text-faint">{Math.round((s.n / f.firstTimers) * 100)}%</span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; display?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[13px]">
          <span className="w-36 shrink-0 truncate">{r.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="shrink-0 text-right text-xs tabular text-muted">{r.display ?? num(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
