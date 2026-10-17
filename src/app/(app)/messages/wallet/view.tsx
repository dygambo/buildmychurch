"use client";
import { useState } from "react";
import { CheckCircle2, CreditCard, Lock, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDateTime, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { topupAction } from "../actions";

type L = { id: number; units: number; kind: string; note: string | null; createdByName: string | null; createdAt: string; amountKobo: number | null };
const KIND: Record<string, string> = { welcome: "Welcome units", topup: "Bought", send: "Sent", refund: "Refund", adjust: "Adjustment" };

export function WalletView({
  balance,
  ledger,
  bundles,
  unitPriceKobo,
  justPaid,
  testMode,
}: {
  balance: number;
  ledger: L[];
  bundles: number[];
  unitPriceKobo: number;
  justPaid: "succeeded" | "failed" | "pending" | null;
  testMode: boolean;
}) {
  const [units, setUnits] = useState(1000);
  const buy = useAction(topupAction, { onSuccess: (d) => (window.location.href = d.authorizationUrl) });
  return (
    <>
      <PageHeader title="SMS units" description="One unit sends one SMS page to one phone. Units don't expire." />
      {justPaid === "succeeded" && (
        <Note tone="good" icon={<CheckCircle2 className="size-4" />}>
          Payment received. Your units are ready to use.
        </Note>
      )}
      {justPaid === "pending" && <Note tone="accent">We're waiting for the bank to confirm your payment. Units arrive as soon as it does.</Note>}
      {justPaid === "failed" && <Note tone="bad">That payment didn't go through, so no units were added. Try again.</Note>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-4 max-lg:grid-cols-1">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
                <MessageSquareText className="size-5" />
              </span>
              <div>
                <div className="text-[13px] text-muted">Units left</div>
                <div className={cn("tabular text-3xl font-semibold", balance < 50 && "text-bad")} data-testid="sms-balance">
                  {balance.toLocaleString("en-NG")}
                </div>
              </div>
            </div>
            <div className="border-t border-line pt-4">
              <div className="mb-2 text-[13px] font-medium">Buy units</div>
              <div className="grid grid-cols-3 gap-2">
                {bundles.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setUnits(b)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-center",
                      units === b ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface hover:bg-surface-2",
                    )}
                  >
                    <div className="tabular text-sm font-semibold">{b.toLocaleString("en-NG")}</div>
                    <div className="text-[11px] text-muted">{naira(b * unitPriceKobo)}</div>
                  </button>
                ))}
              </div>
              <Field label="Or enter how many" htmlFor="w-units" error={buy.fieldErrors.units} className="mt-3">
                <Input id="w-units" inputMode="numeric" value={units || ""} onChange={(e) => setUnits(Number(e.target.value.replace(/\D/g, "")) || 0)} />
              </Field>
              <Button variant="primary" size="lg" className="mt-3 w-full justify-center" loading={buy.pending} disabled={units < 100} onClick={() => buy.run({ units })}>
                <CreditCard /> Pay {naira(units * unitPriceKobo)}
              </Button>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-faint">
                <Lock className="size-3" /> {testMode ? "Test mode: no real money moves" : "Paid securely through Paystack"} · {naira(unitPriceKobo)} per unit
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="History" />
          {ledger.length === 0 ? (
            <EmptyState title="Nothing yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>What</Th>
                  <Th className="max-sm:hidden">When</Th>
                  <Th num>Units</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <div className="font-medium">{KIND[l.kind]}</div>
                      <div className="line-clamp-1 text-xs text-muted">
                        {l.note}
                        {l.amountKobo ? ` · ${naira(l.amountKobo)}` : ""}
                        {l.createdByName ? ` · ${l.createdByName}` : ""}
                      </div>
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-muted max-sm:hidden">{formatDateTime(l.createdAt)}</Td>
                    <Td num className={l.units > 0 ? "font-semibold text-good" : undefined}>
                      {l.units > 0 ? "+" : "−"}
                      {Math.abs(l.units).toLocaleString("en-NG")}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
