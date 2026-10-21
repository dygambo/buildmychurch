"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Lock, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note, Stat } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { StackedBars } from "@/components/charts";
import { formatDate, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLOR_VAR } from "../giving/labels";

type Fund = { id: string; name: string; color: string; restricted: boolean; opening: number; inflow: number; outflow: number; balance: number };
type Data = {
  year: number;
  monthly: { month: string; income: number; spending: number; fees: number }[];
  byCategory: { id: string; name: string; color: string; actual: number; budget: number; budgetToDate: number }[];
  totals: { income: number; spending: number; fees: number };
  budgetTotal: number;
  funds: Fund[];
  unassignedSpendKobo: number;
  openingDate: string | null;
  awaitingApproval: number;
  awaitingPayment: number;
  awaitingPaymentKobo: number;
  thisMonth: { income: number; spending: number } | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const compact = (k: number) => naira(k, { compact: Math.abs(k) >= 100_000_000 });

export function AccountsOverview({ data, thisYear, canApprove }: { data: Data; thisYear: number; canApprove: boolean }) {
  const router = useRouter();
  const surplus = data.totals.income - data.totals.spending;
  const lastIdx = data.year === thisYear ? new Date().getMonth() : 11;
  const chart = data.monthly.slice(0, lastIdx + 1).map((m, i) => ({
    label: MONTHS[i]!,
    income: m.income / 100,
    spending: m.spending / 100,
  }));
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);
  const restricted = data.funds.filter((f) => f.restricted);
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Money in from giving, money out through approved expenses, and what each fund holds."
        actions={
          <>
            <Select aria-label="Year" value={data.year} onChange={(e) => router.replace(`/expenses?year=${e.target.value}`)} className="w-28">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Button variant="primary" asChild>
              <Link href="/expenses/list?new=1">
                <Plus /> Record expense
              </Link>
            </Button>
          </>
        }
      />

      {(data.awaitingApproval > 0 || data.awaitingPayment > 0) && (
        <Note tone="accent">
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {data.awaitingApproval > 0 && (
              <Link href="/expenses/list?status=submitted" className="font-medium hover:underline">
                {data.awaitingApproval} expense{data.awaitingApproval === 1 ? "" : "s"} waiting for approval
                {canApprove ? "" : " by a pastor"}
              </Link>
            )}
            {data.awaitingPayment > 0 && (
              <Link href="/expenses/list?status=approved" className="font-medium hover:underline">
                {data.awaitingPayment} approved, not yet paid ({naira(data.awaitingPaymentKobo)})
              </Link>
            )}
          </span>
        </Note>
      )}

      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label={`Income ${data.year}`} value={compact(data.totals.income)} sub="Confirmed giving, after reversals" />
        <Stat label={`Spending ${data.year}`} value={compact(data.totals.spending)} sub="Paid expenses" />
        <Stat
          label="Surplus"
          value={compact(surplus)}
          tone={surplus >= 0 ? "good" : "bad"}
          sub={data.totals.income ? `${Math.round((surplus / data.totals.income) * 100)}% of income kept` : "No income recorded yet"}
        />
        <Stat
          label="Budget used"
          value={data.budgetTotal ? `${Math.round((data.totals.spending / data.budgetTotal) * 100)}%` : "No budget"}
          sub={
            data.budgetTotal ? (
              `${naira(data.totals.spending, { compact: true })} of ${naira(data.budgetTotal, { compact: true })}`
            ) : (
              <Link href="/expenses/budgets" className="text-accent">
                Set a budget
              </Link>
            )
          }
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader
            title="Income and spending by month"
            action={
              <span className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-accent" /> Income
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: "var(--c4)" }} /> Spending
                </span>
              </span>
            }
          />
          <CardBody>
            <StackedBars
              grouped
              data={chart}
              label={`Income and spending by month in ${data.year}`}
              series={[
                { key: "income", name: "Income", color: "var(--accent)" },
                { key: "spending", name: "Spending", color: "var(--c4)" },
              ]}
              format={(v) => (v >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `₦${Math.round(v / 1000)}k` : `₦${v}`)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Spending against budget" action={<Link href="/expenses/budgets" className="text-[13px] text-accent">Budgets</Link>} />
          {data.byCategory.length === 0 ? (
            <EmptyState title="Nothing spent yet">Paid expenses show here by category.</EmptyState>
          ) : (
            <CardBody className="flex flex-col gap-3.5">
              {data.byCategory.slice(0, 8).map((c) => {
                const pct = c.budget ? Math.round((c.actual / c.budget) * 100) : null;
                const over = c.budgetToDate > 0 && c.actual > c.budgetToDate;
                return (
                  <div key={c.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2 shrink-0 rounded-sm" style={{ background: COLOR_VAR[c.color] }} />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="tabular shrink-0 font-medium">
                        {naira(c.actual, { compact: c.actual >= 100_000_000 })}
                        {c.budget > 0 && <span className="font-normal text-faint"> / {naira(c.budget, { compact: true })}</span>}
                      </span>
                    </div>
                    {pct !== null ? (
                      <span className="relative h-1.5 overflow-hidden rounded-full bg-surface-3" title={`${pct}% of the year's budget`}>
                        <span
                          className={cn("block h-full rounded-full", pct > 100 ? "bg-bad" : over ? "bg-warn" : "bg-good")}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                        {data.year === thisYear && c.budget > 0 && (
                          <span
                            className="absolute top-0 h-full w-0.5 bg-faint"
                            style={{ left: `${Math.min(100, (c.budgetToDate / c.budget) * 100)}%` }}
                          />
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-faint">No budget set</span>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-faint">The thin line marks how much of the budget the year so far allows.</p>
            </CardBody>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Fund balances"
          action={
            <span className="text-xs text-muted">
              {data.openingDate ? `From opening balances on ${formatDate(data.openingDate)}` : "From the first record"}
            </span>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Fund</Th>
              <Th num className="max-md:hidden">
                Opening
              </Th>
              <Th num className="max-sm:hidden">
                In
              </Th>
              <Th num className="max-sm:hidden">
                Out
              </Th>
              <Th num>Balance</Th>
            </tr>
          </thead>
          <tbody>
            {data.funds.map((f) => (
              <Tr key={f.id}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-sm" style={{ background: COLOR_VAR[f.color] }} />
                    <span className="font-medium">{f.name}</span>
                    {f.restricted && (
                      <Badge tone="purple">
                        <Lock className="size-3" /> Restricted
                      </Badge>
                    )}
                  </span>
                </Td>
                <Td num className="text-muted max-md:hidden">
                  {naira(f.opening)}
                </Td>
                <Td num className="max-sm:hidden">
                  {naira(f.inflow)}
                </Td>
                <Td num className="text-muted max-sm:hidden">
                  {f.outflow ? `−${naira(f.outflow)}` : naira(0)}
                </Td>
                <Td num className={cn("font-semibold", f.balance < 0 && "text-bad")}>
                  {naira(f.balance)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <CardBody className="flex flex-col gap-2 border-t border-line text-[13px] text-muted">
          {data.unassignedSpendKobo > 0 && (
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              {naira(data.unassignedSpendKobo)} of paid expenses isn&apos;t charged to a fund, so it isn&apos;t taken off any balance above.
            </p>
          )}
          {restricted.some((f) => f.balance < 0) && (
            <p className="flex items-start gap-2 text-bad">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              A restricted fund has spent more than it received. Check the expenses charged to it.
            </p>
          )}
          {canApprove && !data.openingDate && (
            <Link href="/expenses/settings" className="flex items-center gap-1 text-accent">
              Add the money each fund held before you started <ArrowRight className="size-3.5" />
            </Link>
          )}
        </CardBody>
      </Card>
    </>
  );
}
