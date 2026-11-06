"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Calculator, CheckCircle2, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Note, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDate, naira, todayISO } from "@/lib/format";
import type { RemittanceRow } from "@/server/services/expenses";
import { calculateRemittancesAction, confirmRemittanceAction, submitRemittanceAction } from "../actions";
import { METHODS, REMIT_STATUS } from "../labels";

const label = (period: string) =>
  new Date(`${period}-15T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });

export function RemittancesView({
  period,
  rows,
  outstanding,
  rateBps,
  basis,
  branchCount,
  canCalculate,
}: {
  period: string;
  rows: RemittanceRow[];
  outstanding: RemittanceRow[];
  rateBps: number;
  basis: string;
  branchCount: number;
  canCalculate: boolean;
}) {
  const router = useRouter();
  const [paying, setPaying] = useState<RemittanceRow | null>(null);
  const calc = useAction(calculateRemittancesAction, { onSuccess: () => router.refresh() });
  const confirm = useAction(confirmRemittanceAction, { onSuccess: () => router.refresh() });
  const now = todayISO().slice(0, 7);
  const periods = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${now}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i - 1);
    return d.toISOString().slice(0, 7);
  });
  const due = rows.reduce((s, r) => s + r.dueKobo, 0);
  const received = rows.filter((r) => r.status === "confirmed").reduce((s, r) => s + r.paidKobo, 0);
  const waiting = rows.filter((r) => r.status === "submitted").reduce((s, r) => s + r.paidKobo, 0);

  if (branchCount < 2)
    return (
      <>
        <PageHeader title="Branch remittances" />
        <Card>
          <EmptyState
            icon={<Building2 />}
            title="Remittances start when you have branches"
            action={
              <Button asChild>
                <Link href="/branches">Add a branch</Link>
              </Button>
            }
          >
            Each month, branches send headquarters a share of their income. With only one branch there&apos;s nothing to send.
          </EmptyState>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title="Branch remittances"
        description={
          rateBps
            ? `Each branch sends headquarters ${rateBps / 100}% of its ${basis === "all" ? "" : "general (unrestricted) "}income for the month. The branch records the payment; headquarters confirms it arrived.`
            : "Remittances are switched off. Set a percentage in Settings to start."
        }
        actions={
          <>
            <Select aria-label="Month" value={period} onChange={(e) => router.replace(`/expenses/remittances?period=${e.target.value}`)} className="w-44">
              {periods.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </Select>
            {canCalculate && rateBps > 0 && (
              <Button variant="primary" loading={calc.pending} onClick={() => calc.run({ period })}>
                <Calculator /> {rows.length ? "Recalculate" : "Work out"}
              </Button>
            )}
          </>
        }
      />
      {outstanding.length > 0 && (
        <Note tone="warn">
          Still due from earlier months:{" "}
          {outstanding.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link href={`/expenses/remittances?period=${r.period}`} className="font-medium underline-offset-2 hover:underline">
                {r.branchName} ({label(r.period)}, {naira(r.dueKobo)})
              </Link>
            </span>
          ))}
        </Note>
      )}
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <Stat label={`Due for ${label(period)}`} value={naira(due)} sub={`${rows.length} branch${rows.length === 1 ? "" : "es"}`} />
        <Stat label="Waiting for confirmation" value={naira(waiting)} />
        <Stat label="Received" value={naira(received)} tone={received >= due && due > 0 ? "good" : undefined} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Landmark />} title={`Nothing worked out for ${label(period)} yet`}>
            {canCalculate
              ? "Work it out from each branch's confirmed giving. It also runs by itself on the 1st of each month."
              : "Headquarters works these out on the 1st of each month."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th num className="max-md:hidden">
                  Income
                </Th>
                <Th num>Due</Th>
                <Th num className="max-sm:hidden">
                  Paid
                </Th>
                <Th>Status</Th>
                <Th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = REMIT_STATUS[r.status]!;
                return (
                  <Tr key={r.id}>
                    <Td>
                      <div className="font-medium">{r.branchName}</div>
                      {r.paidOn && (
                        <div className="text-xs text-faint">
                          {METHODS[r.method ?? "other"]} on {formatDate(r.paidOn)}
                          {r.paymentRef && <span className="font-mono"> · {r.paymentRef}</span>}
                        </div>
                      )}
                    </Td>
                    <Td num className="text-muted max-md:hidden">
                      {naira(r.incomeKobo)}
                      <div className="text-xs text-faint">at {r.rateBps / 100}%</div>
                    </Td>
                    <Td num className="font-medium">
                      {naira(r.dueKobo)}
                    </Td>
                    <Td num className="max-sm:hidden">
                      {r.paidKobo ? (
                        <span className={r.paidKobo < r.dueKobo ? "text-warn" : undefined}>{naira(r.paidKobo)}</span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {r.status === "confirmed" && <div className="mt-0.5 text-xs text-faint">by {r.confirmedByName}</div>}
                      {r.status === "submitted" && <div className="mt-0.5 text-xs text-faint">by {r.submittedByName}</div>}
                    </Td>
                    <Td className="text-right">
                      {r.canConfirm ? (
                        <Button size="sm" variant="success" loading={confirm.pending} onClick={() => confirm.run({ id: r.id })}>
                          <CheckCircle2 /> Confirm
                        </Button>
                      ) : r.canSubmit ? (
                        <Button size="sm" onClick={() => setPaying(r)}>
                          {r.status === "submitted" ? "Edit payment" : "Record payment"}
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <PayDialog r={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function PayDialog({ r, onClose }: { r: RemittanceRow | null; onClose: () => void }) {
  const router = useRouter();
  const act = useAction(submitRemittanceAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={!!r} onOpenChange={(o) => !o && onClose()}>
      {r && (
        <DialogContent
          title={`${r.branchName}: ${label(r.period)}`}
          description={`${naira(r.dueKobo)} due (${r.rateBps / 100}% of ${naira(r.incomeKobo)}).`}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="remit-form" variant="primary" loading={act.pending}>
                Record payment
              </Button>
            </>
          }
        >
          <form
            id="remit-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act.run({
                id: r.id,
                amount: String(f.get("amount")),
                paidOn: String(f.get("paidOn")),
                method: String(f.get("method")) as "transfer",
                paymentRef: String(f.get("paymentRef") ?? ""),
                note: String(f.get("note") ?? ""),
              });
            }}
          >
            <Field label="Amount sent (₦)" htmlFor="rm-a" error={act.fieldErrors.amount}>
              <Input id="rm-a" name="amount" inputMode="decimal" className="tabular" defaultValue={((r.paidKobo || r.dueKobo) / 100).toString()} />
            </Field>
            <Field label="Date sent" htmlFor="rm-d" error={act.fieldErrors.paidOn}>
              <Input id="rm-d" name="paidOn" type="date" max={todayISO()} defaultValue={r.paidOn ?? todayISO()} />
            </Field>
            <Field label="How" htmlFor="rm-m">
              <Select id="rm-m" name="method" defaultValue={r.method ?? "transfer"}>
                {Object.entries(METHODS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="rm-r" error={act.fieldErrors.paymentRef}>
              <Input id="rm-r" name="paymentRef" defaultValue={r.paymentRef ?? ""} placeholder="Transfer reference" />
            </Field>
            <Field label="Note" htmlFor="rm-n" optional className="col-span-full">
              <Textarea id="rm-n" name="note" rows={2} defaultValue={r.note ?? ""} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
