import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { formatDate, naira, todayISO } from "@/lib/format";
import { portalGiving } from "@/server/services/portal";
import { requireMember } from "../session";

const CH: Record<string, string> = { cash: "Cash", pos: "POS", transfer: "Transfer", cheque: "Cheque", online: "Online", other: "Other" };

export default async function PortalGiving({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ year?: string }> }) {
  const { slug } = await params;
  const { church, me } = await requireMember(slug);
  const thisYear = Number(todayISO().slice(0, 4));
  const y = Number((await searchParams).year);
  const year = y >= 2000 && y <= thisYear ? y : thisYear;
  const g = await portalGiving(church, me, year);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Your giving</h1>
        <div className="flex gap-1">
          {[thisYear, thisYear - 1, thisYear - 2].map((x) => (
            <Link key={x} href={`/m/${slug}/giving?year=${x}`} aria-current={x === year ? "page" : undefined} className={x === year ? "rounded-lg bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent" : "rounded-lg px-2.5 py-1 text-[13px] text-muted"}>
              {x}
            </Link>
          ))}
        </div>
      </div>
      <Card>
        <CardBody className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-muted">Total in {year}</div>
            <div className="text-2xl font-semibold tabular" data-testid="giving-total">
              {naira(g.total)}
            </div>
            <div className="text-xs text-faint">{g.monthsGiven ? `Gave in ${g.monthsGiven} of 12 months` : "Nothing recorded yet"}</div>
          </div>
          <Button asChild>
            <a href={`/m/${slug}/giving/statement?year=${year}`}>
              <Download /> Statement
            </a>
          </Button>
        </CardBody>
        {g.byFund.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            {g.byFund.map((f) => (
              <span key={f.fund} className="rounded-full bg-surface-2 px-3 py-1 text-xs">
                {f.fund}: <b className="tabular">{naira(f.amount)}</b>
              </span>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Gifts" />
        {g.rows.length === 0 ? (
          <EmptyState title={`No gifts recorded for ${year}`}>Gifts given in an envelope with your name, by transfer, or online with your email appear here once the church records them.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {[...g.rows].reverse().map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[13px] first:border-t-0">
                <div className="flex-1">
                  <div className="font-medium">
                    {r.fundName}
                    {r.reversalOf ? " (reversed)" : ""}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(r.givenOn)} · {CH[r.channel] ?? r.channel}
                    {r.receiptNo ? ` · ${r.receiptNo}` : ""}
                  </div>
                </div>
                <span className={r.amountKobo < 0 ? "tabular text-bad" : "tabular font-medium"}>{naira(r.amountKobo)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
