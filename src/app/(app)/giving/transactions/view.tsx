"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, MoreHorizontal, Receipt, Undo2, UserRoundPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBox } from "@/components/ui/search-box";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDate, naira } from "@/lib/format";
import type { TxFilters, TxRow } from "@/server/services/giving";
import { MemberPicker } from "../../members/member-picker";
import { assignGiverAction, findGiversAction, reverseAction } from "../actions";
import { CHANNELS, COLOR_VAR } from "../labels";

export function TransactionsView({
  list,
  filters,
  funds,
  branches,
  can,
}: {
  list: { rows: TxRow[]; total: number; sumKobo: number; page: number; pageSize: number };
  filters: TxFilters;
  funds: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  can: { reverse: boolean; assign: boolean; named: boolean };
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [reversing, setReversing] = useState<TxRow | null>(null);
  const [assigning, setAssigning] = useState<TxRow | null>(null);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const exportHref = (format: string) => {
    const next = new URLSearchParams(sp.toString());
    next.delete("page");
    next.set("format", format);
    return `/giving/transactions/export?${next}`;
  };
  const filtered = Boolean(filters.from || filters.to || filters.fundId || filters.channel || filters.q || filters.source || filters.branchId || (filters.status && filters.status !== "confirmed"));

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every gift on the ledger. Confirmed gifts can't be edited; mistakes are reversed, and both entries stay."
        actions={
          <>
            <Button asChild>
              <a href={exportHref("xlsx")}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href={exportHref("csv")}>
                <Download /> CSV
              </a>
            </Button>
          </>
        }
      />
      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchBox
          placeholder={can.named ? "Giver, reference or receipt" : "Reference or receipt number"}
          className="w-64 max-sm:w-full"
        />
        <Field label="From" htmlFor="f-from">
          <Input id="f-from" type="date" defaultValue={filters.from} onChange={(e) => setParam("from", e.target.value)} />
        </Field>
        <Field label="To" htmlFor="f-to">
          <Input id="f-to" type="date" defaultValue={filters.to} onChange={(e) => setParam("to", e.target.value)} />
        </Field>
        <Field label="Fund" htmlFor="f-fund">
          <Select id="f-fund" value={filters.fundId ?? ""} onChange={(e) => setParam("fund", e.target.value)}>
            <option value="">All funds</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How" htmlFor="f-channel">
          <Select id="f-channel" value={filters.channel ?? ""} onChange={(e) => setParam("channel", e.target.value)}>
            <option value="">Any way</option>
            {Object.entries(CHANNELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="f-status">
          <Select id="f-status" value={filters.status ?? ""} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Confirmed</option>
            <option value="reversed">Reversed</option>
            <option value="pending">Waiting for payment</option>
            <option value="failed">Payment failed</option>
            <option value="all">Everything</option>
          </Select>
        </Field>
        {branches.length > 1 && (
          <Field label="Branch" htmlFor="f-branch">
            <Select id="f-branch" value={filters.branchId ?? ""} onChange={(e) => setParam("branch", e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {filtered && (
          <Button variant="ghost" onClick={() => router.replace(path, { scroll: false })}>
            Clear
          </Button>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-[13px]">
          <span className="text-muted">
            {list.total.toLocaleString("en-NG")} entr{list.total === 1 ? "y" : "ies"}
          </span>
          <span className="tabular ml-auto font-semibold">Net {naira(list.sumKobo)}</span>
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={<Receipt />} title={filtered ? "Nothing matches these filters" : "No gifts yet"}>
            {filtered ? "Try a wider date range or clear the filters." : "Verified collections and online gifts appear here."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Giver</Th>
                <Th className="max-md:hidden">Fund</Th>
                <Th className="max-lg:hidden">How</Th>
                <Th className="max-xl:hidden">Reference</Th>
                <Th num>Amount</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <Tr key={r.id} className={r.status === "failed" ? "opacity-60" : undefined}>
                  <Td className="whitespace-nowrap">{formatDate(r.givenOn)}</Td>
                  <Td>
                    {r.memberId ? (
                      <Link href={`/members/${r.memberId}`} className="font-medium hover:text-accent">
                        {r.giver}
                      </Link>
                    ) : (
                      <span className={r.giver === "Named gift" || r.giver === "Collection" ? "text-muted" : "font-medium"}>
                        {r.giver}
                      </span>
                    )}
                    <div className="text-xs text-faint md:hidden">{r.fundName}</div>
                    {r.note && <div className="text-xs text-faint">{r.note}</div>}
                  </Td>
                  <Td className="max-md:hidden">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-sm" style={{ background: COLOR_VAR[r.fundColor] }} />
                      {r.fundName}
                    </span>
                  </Td>
                  <Td className="text-muted max-lg:hidden">
                    {CHANNELS[r.channel]}
                    {r.gatewayChannel && <span className="text-faint"> · {r.gatewayChannel.replace("_", " ")}</span>}
                  </Td>
                  <Td className="max-xl:hidden">
                    <div className="font-mono text-xs">{r.reference}</div>
                    {r.receiptNo && <div className="font-mono text-xs text-faint">{r.receiptNo}</div>}
                  </Td>
                  <Td num>
                    <span className={r.amountKobo < 0 ? "text-bad" : "font-medium"}>{naira(r.amountKobo)}</span>
                    <div className="flex justify-end gap-1">
                      {r.reversed && <Badge tone="bad">Reversed</Badge>}
                      {r.source === "reversal" && <Badge tone="neutral">Reversal</Badge>}
                      {r.status === "pending" && <Badge tone="warn">Waiting</Badge>}
                      {r.status === "failed" && <Badge tone="bad">Failed</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <RowMenu
                      r={r}
                      can={can}
                      onReverse={() => setReversing(r)}
                      onAssign={() => setAssigning(r)}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          hrefFor={(p) => {
            const next = new URLSearchParams(sp.toString());
            next.set("page", String(p));
            return `${path}?${next}`;
          }}
        />
      </Card>
      <ReverseDialog tx={reversing} onClose={() => setReversing(null)} />
      <AssignDialog tx={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}

function RowMenu({
  r,
  can,
  onReverse,
  onAssign,
}: {
  r: TxRow;
  can: { reverse: boolean; assign: boolean };
  onReverse: () => void;
  onAssign: () => void;
}) {
  const canReverse = can.reverse && r.status === "confirmed" && !r.reversed && r.source !== "reversal";
  const canAssign = can.assign && r.status === "confirmed" && r.source !== "reversal" && !r.reversed;
  if (!canReverse && !canAssign && !r.batchId) return null;
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${r.reference}`}>
          <MoreHorizontal />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        {r.batchId && (
          <DropdownItem asChild>
            <Link href={`/giving/batches/${r.batchId}`}>
              <Receipt /> Open the collection
            </Link>
          </DropdownItem>
        )}
        {canAssign && (
          <DropdownItem onSelect={onAssign}>
            <UserRoundPlus /> {r.memberId ? "Change linked member" : "Link to a member"}
          </DropdownItem>
        )}
        {canReverse && (
          <DropdownItem danger onSelect={onReverse}>
            <Undo2 /> Reverse
          </DropdownItem>
        )}
      </DropdownContent>
    </Dropdown>
  );
}

function ReverseDialog({ tx, onClose }: { tx: TxRow | null; onClose: () => void }) {
  const act = useAction(reverseAction, { onSuccess: onClose });
  const [reason, setReason] = useState("");
  return (
    <Dialog open={!!tx} onOpenChange={(o) => !o && onClose()}>
      {tx && (
        <DialogContent
          title={`Reverse ${naira(tx.amountKobo)}?`}
          description={`${tx.giver} · ${tx.fundName} · ${formatDate(tx.givenOn)} · ${tx.reference}`}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="danger" loading={act.pending} onClick={() => act.run({ id: tx.id, reason })}>
                <Undo2 /> Reverse
              </Button>
            </>
          }
        >
          <Note>
            The original gift stays on the ledger, marked reversed, and a matching negative entry is added today. Both
            appear in the audit log.
          </Note>
          {tx.source === "online" && (
            <Note tone="warn">This was paid online. Reversing here doesn&apos;t return the money: refund it from Paystack too.</Note>
          )}
          <Field label="Why are you reversing it?" htmlFor="rv-reason" error={act.fieldErrors.reason}>
            <Textarea
              id="rv-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Counted twice, Bounced cheque"
            />
          </Field>
        </DialogContent>
      )}
    </Dialog>
  );
}

function AssignDialog({ tx, onClose }: { tx: TxRow | null; onClose: () => void }) {
  const act = useAction(assignGiverAction, { onSuccess: onClose });
  return (
    <Dialog open={!!tx} onOpenChange={(o) => !o && onClose()}>
      {tx && (
        <DialogContent
          title="Link to a member"
          description={`${naira(tx.amountKobo)} · ${tx.fundName} · ${formatDate(tx.givenOn)}`}
          footer={
            <>
              {tx.memberId && (
                <Button variant="ghost" loading={act.pending} onClick={() => act.run({ id: tx.id, memberId: null })}>
                  Remove link
                </Button>
              )}
              <Button onClick={onClose}>Cancel</Button>
            </>
          }
        >
          <p className="text-[13px] text-muted">
            The gift then shows on the member&apos;s giving record and annual statement, and counts towards their pledge
            if they have one.
          </p>
          <MemberPicker autoFocus search={findGiversAction} onPick={(m) => act.run({ id: tx.id, memberId: m.id })} />
        </DialogContent>
      )}
    </Dialog>
  );
}
