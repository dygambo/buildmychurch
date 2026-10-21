"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Plus, Send, ShieldAlert, Trash2, Undo2, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatDateTime, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MemberPicker } from "../../../members/member-picker";
import {
  deleteBatchAction,
  findGiversAction,
  rejectBatchAction,
  saveBatchLinesAction,
  submitBatchAction,
  verifyBatchAction,
} from "../../actions";
import { BATCH_KIND, BATCH_STATUS, CHANNELS, toKobo, toNairaInput } from "../../labels";

type Line = {
  id: string;
  fundId: string;
  fundName: string;
  channel: string;
  amountKobo: number;
  memberId: string | null;
  named: boolean;
  name: string | null;
  memberNo: string | null;
  note: string | null;
};
type Batch = {
  id: string;
  batchNo: string;
  kind: string;
  label: string;
  givenOn: string;
  status: string;
  totalKobo: number;
  cashCount: Record<string, number> | null;
  notes: string | null;
  countedByName: string;
  verifiedByName: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectionNote: string | null;
  serviceName: string | null;
  branchName: string;
  isCounter: boolean;
  canEdit: boolean;
  canVerify: boolean;
  lines: Line[];
};
type Fund = { id: string; name: string };
type Envelope = {
  key: string;
  memberId: string | null;
  name: string;
  memberNo: string | null;
  fundId: string;
  channel: string;
  amount: string;
  note: string;
};

const GRID_CHANNELS = ["cash", "pos", "transfer", "cheque"] as const;
let seq = 0;

export function BatchDetail({
  batch: b,
  funds,
  denominations,
  verifierRole,
}: {
  batch: Batch;
  funds: Fund[];
  denominations: number[];
  verifierRole: boolean;
}) {
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/giving/batches">
            <ArrowLeft /> Collections
          </Link>
        </Button>
      </div>
      <PageHeader
        title={b.label}
        description={
          <>
            <span className="font-mono">{b.batchNo}</span> · {BATCH_KIND[b.kind]} · {formatDate(b.givenOn, "long")}
            {b.branchName && ` · ${b.branchName}`}
          </>
        }
        actions={<Badge tone={BATCH_STATUS[b.status]!.tone}>{BATCH_STATUS[b.status]!.label}</Badge>}
      />
      {b.status === "rejected" && b.rejectionNote && (
        <Note tone="bad" icon={<Undo2 />}>
          Sent back for changes: “{b.rejectionNote}”
        </Note>
      )}
      {b.canEdit ? (
        <Editor b={b} funds={funds} denominations={denominations} />
      ) : (
        <ReadOnly b={b} denominations={denominations} verifierRole={verifierRole} />
      )}
    </>
  );
}

/* ---------------- counting ---------------- */

function Editor({ b, funds, denominations }: { b: Batch; funds: Fund[]; denominations: number[] }) {
  const router = useRouter();
  const allFunds = useMemo(() => {
    const extra = b.lines.filter((l) => !funds.some((f) => f.id === l.fundId)).map((l) => ({ id: l.fundId, name: l.fundName }));
    return [...funds, ...extra.filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)];
  }, [b.lines, funds]);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>(() => {
    const g: Record<string, Record<string, number>> = {};
    for (const l of b.lines.filter((x) => !x.named)) {
      g[l.fundId] ??= {};
      g[l.fundId]![l.channel] = (g[l.fundId]![l.channel] ?? 0) + l.amountKobo;
    }
    return Object.fromEntries(
      Object.entries(g).map(([f, ch]) => [f, Object.fromEntries(Object.entries(ch).map(([c, k]) => [c, toNairaInput(k)]))]),
    );
  });
  const [envelopes, setEnvelopes] = useState<Envelope[]>(() =>
    b.lines
      .filter((l) => l.named)
      .map((l) => ({
        key: `e${++seq}`,
        memberId: l.memberId,
        name: l.name ?? "",
        memberNo: l.memberNo,
        fundId: l.fundId,
        channel: l.channel,
        amount: toNairaInput(l.amountKobo),
        note: l.note ?? "",
      })),
  );
  const [cash, setCash] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(b.cashCount ?? {}).map(([d, n]) => [d, String(n)])),
  );
  const [showCash, setShowCash] = useState(Boolean(b.cashCount) || b.kind === "service");
  const [notes, setNotes] = useState(b.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totals = useMemo(() => {
    const byChannel: Record<string, number> = {};
    let all = 0;
    for (const ch of Object.values(grid))
      for (const [c, v] of Object.entries(ch)) {
        byChannel[c] = (byChannel[c] ?? 0) + toKobo(v);
        all += toKobo(v);
      }
    for (const e of envelopes) {
      byChannel[e.channel] = (byChannel[e.channel] ?? 0) + toKobo(e.amount);
      all += toKobo(e.amount);
    }
    return { byChannel, all };
  }, [grid, envelopes]);
  const counted = denominations.reduce((s, d) => s + d * 100 * (Number(cash[d]) || 0), 0);
  const cashLines = totals.byChannel.cash ?? 0;
  const diff = counted - cashLines;
  const cashUsed = Object.values(cash).some((v) => Number(v) > 0);

  const payload = () => ({
    id: b.id,
    lines: [
      ...Object.entries(grid).flatMap(([fundId, ch]) =>
        Object.entries(ch)
          .filter(([, v]) => toKobo(v) > 0)
          .map(([channel, v]) => ({ fundId, channel: channel as "cash", amount: String(toKobo(v) / 100) })),
      ),
      ...envelopes
        .filter((e) => toKobo(e.amount) > 0)
        .map((e) => ({
          fundId: e.fundId,
          channel: e.channel as "cash",
          amount: String(toKobo(e.amount) / 100),
          memberId: e.memberId ?? "",
          donorName: e.memberId ? "" : e.name,
          note: e.note,
        })),
    ],
    cashCount: showCash && cashUsed ? Object.fromEntries(Object.entries(cash).map(([d, n]) => [d, Number(n) || 0])) : null,
    notes,
  });
  const save = useAction(saveBatchLinesAction, { onSuccess: () => router.refresh() });
  const submit = useAction(submitBatchAction, { onSuccess: () => router.refresh() });
  const del = useAction(deleteBatchAction, { onSuccess: () => router.push("/giving/batches") });
  const badEnvelope = envelopes.some((e) => toKobo(e.amount) > 0 && !e.memberId && !e.name.trim());

  const setCell = (fundId: string, channel: string, v: string) =>
    setGrid((g) => ({ ...g, [fundId]: { ...(g[fundId] ?? {}), [channel]: v } }));

  return (
    <>
      <Card>
        <CardHeader title="Totals by fund" action={<span className="text-xs text-faint">Amounts in naira</span>} />
        <CardBody className="flex flex-col gap-1">
          <div className="hidden grid-cols-[minmax(140px,1.2fr)_repeat(4,minmax(0,1fr))_minmax(0,0.9fr)] gap-2 px-1 pb-1 text-xs font-medium text-faint sm:grid">
            <span>Fund</span>
            {GRID_CHANNELS.map((c) => (
              <span key={c}>{CHANNELS[c]}</span>
            ))}
            <span className="text-right">Total</span>
          </div>
          {allFunds.map((f) => {
            const rowTotal = GRID_CHANNELS.reduce((s, c) => s + toKobo(grid[f.id]?.[c] ?? ""), 0);
            return (
              <div
                key={f.id}
                className="grid grid-cols-2 items-center gap-2 border-b border-line py-2 last:border-b-0 sm:grid-cols-[minmax(140px,1.2fr)_repeat(4,minmax(0,1fr))_minmax(0,0.9fr)]"
              >
                <span className="col-span-full text-[13px] font-medium sm:col-span-1">{f.name}</span>
                {GRID_CHANNELS.map((c) => (
                  <label key={c} className="flex flex-col gap-1">
                    <span className="text-[11px] text-faint sm:sr-only">{CHANNELS[c]}</span>
                    <Input
                      inputMode="decimal"
                      aria-label={`${f.name} ${CHANNELS[c]}`}
                      className="tabular text-right"
                      placeholder="0"
                      value={grid[f.id]?.[c] ?? ""}
                      onChange={(e) => setCell(f.id, c, e.target.value)}
                    />
                  </label>
                ))}
                <span className="tabular col-span-full text-right text-[13px] font-semibold sm:col-span-1">
                  {rowTotal ? naira(rowTotal) : <span className="text-faint">—</span>}
                </span>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Named envelopes and transfers"
          action={
            <Button
              size="sm"
              variant="soft"
              onClick={() =>
                setEnvelopes((es) => [
                  ...es,
                  {
                    key: `e${++seq}`,
                    memberId: null,
                    name: "",
                    memberNo: null,
                    fundId: allFunds[0]?.id ?? "",
                    channel: b.kind === "transfers" ? "transfer" : "cash",
                    amount: "",
                    note: "",
                  },
                ])
              }
            >
              <Plus /> Add a named gift
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-3">
          {envelopes.length === 0 ? (
            <p className="text-[13px] text-muted">
              Add tithe envelopes and transfers with a name, so they appear on the giver&apos;s record and annual
              statement. Unnamed money goes in the totals above.
            </p>
          ) : (
            envelopes.map((e, i) => (
              <div key={e.key} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] items-end gap-2 rounded-xl border border-line p-2.5 max-lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5 max-lg:col-span-full">
                  <span className="text-[12.5px] font-medium text-muted">Giver {i + 1}</span>
                  {e.memberId ? (
                    <div className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-[13px]">
                      <UserRound className="size-4 text-faint" />
                      <span className="flex-1 truncate font-medium">{e.name}</span>
                      <span className="font-mono text-xs text-faint">{e.memberNo}</span>
                      <button
                        type="button"
                        aria-label="Choose someone else"
                        className="text-faint hover:text-fg"
                        onClick={() => setEnvelopes((es) => es.map((x) => (x.key === e.key ? { ...x, memberId: null, name: "", memberNo: null } : x)))}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <EnvelopeName
                      value={e.name}
                      onName={(name) => setEnvelopes((es) => es.map((x) => (x.key === e.key ? { ...x, name } : x)))}
                      onMember={(m) =>
                        setEnvelopes((es) =>
                          es.map((x) => (x.key === e.key ? { ...x, memberId: m.id, name: m.name, memberNo: m.memberNo } : x)),
                        )
                      }
                    />
                  )}
                </div>
                <Field label="Fund" htmlFor={`env-f-${e.key}`}>
                  <Select
                    id={`env-f-${e.key}`}
                    value={e.fundId}
                    onChange={(ev) => setEnvelopes((es) => es.map((x) => (x.key === e.key ? { ...x, fundId: ev.target.value } : x)))}
                  >
                    {allFunds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="How" htmlFor={`env-c-${e.key}`}>
                  <Select
                    id={`env-c-${e.key}`}
                    value={e.channel}
                    onChange={(ev) => setEnvelopes((es) => es.map((x) => (x.key === e.key ? { ...x, channel: ev.target.value } : x)))}
                  >
                    {[...GRID_CHANNELS, "other"].map((c) => (
                      <option key={c} value={c}>
                        {CHANNELS[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount (₦)" htmlFor={`env-a-${e.key}`}>
                  <Input
                    id={`env-a-${e.key}`}
                    inputMode="decimal"
                    className="tabular text-right"
                    value={e.amount}
                    onChange={(ev) => setEnvelopes((es) => es.map((x) => (x.key === e.key ? { ...x, amount: ev.target.value } : x)))}
                  />
                </Field>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove giver ${i + 1}`}
                  onClick={() => setEnvelopes((es) => es.filter((x) => x.key !== e.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
          {badEnvelope && <p className="text-xs text-bad">Choose a member or type a name for every named gift.</p>}
        </CardBody>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader
            title="Cash count"
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowCash((s) => !s)}>
                {showCash ? "Hide" : "Count notes"}
              </Button>
            }
          />
          <CardBody>
            {showCash ? (
              <div className="flex flex-col gap-2">
                {denominations.map((d) => (
                  <div key={d} className="grid grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-[13px]">
                    <span className="font-medium">₦{d.toLocaleString("en-NG")}</span>
                    <Input
                      inputMode="numeric"
                      aria-label={`Number of ₦${d} notes`}
                      className="tabular text-right"
                      placeholder="0"
                      value={cash[d] ?? ""}
                      onChange={(e) => setCash((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))}
                    />
                    <span className="tabular text-right text-muted">
                      {Number(cash[d]) ? naira(d * 100 * Number(cash[d])) : "—"}
                    </span>
                  </div>
                ))}
                <div className="mt-2 flex flex-col gap-1 border-t border-line pt-3 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Notes counted</span>
                    <b className="tabular">{naira(counted)}</b>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Cash in the totals</span>
                    <b className="tabular">{naira(cashLines)}</b>
                  </div>
                  {cashUsed && (
                    <div
                      className={cn("flex justify-between font-semibold", diff === 0 ? "text-good" : "text-bad")}
                      role="status"
                    >
                      <span>{diff === 0 ? "Balanced" : diff > 0 ? "More notes than entered" : "Fewer notes than entered"}</span>
                      <span className="tabular">{diff === 0 ? "✓" : naira(Math.abs(diff))}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                Count notes by denomination and we&apos;ll check them against the cash you entered.
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Notes" />
          <CardBody className="flex flex-col gap-2">
            <Textarea
              aria-label="Notes for the verifier"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the verifier should know, e.g. a torn ₦500 note was set aside"
            />
            {cashUsed && diff !== 0 && !notes.trim() && (
              <p className="text-xs text-warn">The cash doesn&apos;t balance. Explain the difference here before submitting.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 px-4 py-3 shadow-card">
        <div className="flex flex-col">
          <span className="text-xs text-muted">Total</span>
          <span className="tabular text-xl font-semibold" data-testid="batch-total">
            {naira(totals.all)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted max-sm:hidden">
          {Object.entries(totals.byChannel)
            .filter(([, v]) => v)
            .map(([c, v]) => (
              <span key={c}>
                {CHANNELS[c]} <b className="tabular text-fg">{naira(v)}</b>
              </span>
            ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete this batch">
            <Trash2 />
          </Button>
          <Button loading={save.pending} disabled={badEnvelope} onClick={() => save.run(payload())}>
            Save draft
          </Button>
          <Button
            variant="primary"
            loading={submit.pending}
            disabled={badEnvelope || totals.all <= 0}
            onClick={() => submit.run(payload())}
          >
            <Send /> Submit for verification
          </Button>
        </div>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        {confirmDelete && (
          <DialogContent
            title="Delete this batch?"
            description="It hasn't been submitted, so nothing has reached the ledger. The audit log keeps a note that it existed."
            footer={
              <>
                <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
                <Button variant="danger" loading={del.pending} onClick={() => del.run({ id: b.id })}>
                  Delete batch
                </Button>
              </>
            }
          >
            <p className="text-[13px]">
              {b.label} · {formatDate(b.givenOn)}
            </p>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** Pick a member, or just type the name on the envelope. */
function EnvelopeName({
  value,
  onName,
  onMember,
}: {
  value: string;
  onName: (v: string) => void;
  onMember: (m: { id: string; name: string; memberNo: string }) => void;
}) {
  const [typing, setTyping] = useState(Boolean(value));
  if (typing)
    return (
      <div className="flex gap-1.5">
        <Input aria-label="Name on the envelope" value={value} onChange={(e) => onName(e.target.value)} placeholder="Name on the envelope" />
        <Button size="sm" variant="ghost" className="h-9" onClick={() => setTyping(false)}>
          Find member
        </Button>
      </div>
    );
  return (
    <div className="flex gap-1.5">
      <div className="min-w-0 flex-1">
        <MemberPicker search={findGiversAction} onPick={onMember} placeholder="Search members" />
      </div>
      <Button size="sm" variant="ghost" className="h-9" onClick={() => setTyping(true)}>
        Not a member
      </Button>
    </div>
  );
}

/* ---------------- reviewing and verifying ---------------- */

function ReadOnly({ b, denominations, verifierRole }: { b: Batch; denominations: number[]; verifierRole: boolean }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const verify = useAction(verifyBatchAction, { onSuccess: () => router.refresh() });
  const reject = useAction(rejectBatchAction, {
    onSuccess: () => {
      setRejecting(false);
      router.refresh();
    },
  });
  const fundNames = [...new Set(b.lines.map((l) => l.fundName))];
  const channels = GRID_CHANNELS.filter((c) => b.lines.some((l) => l.channel === c)).concat(
    b.lines.some((l) => l.channel === "other") ? (["other"] as never[]) : [],
  );
  const cell = (fund: string, ch: string) =>
    b.lines.filter((l) => l.fundName === fund && l.channel === ch).reduce((s, l) => s + l.amountKobo, 0);
  const named = b.lines.filter((l) => l.named);
  const counted = b.cashCount ? denominations.reduce((s, d) => s + d * 100 * (b.cashCount![d] ?? 0), 0) : null;
  const cashTotal = b.lines.filter((l) => l.channel === "cash").reduce((s, l) => s + l.amountKobo, 0);

  return (
    <>
      {b.status === "submitted" && b.canVerify && (
        <Card className="border-accent-line">
          <CardBody className="flex flex-wrap items-center gap-3">
            <ShieldAlert className="size-5 text-accent" />
            <div className="min-w-0 flex-1 text-[13px]">
              <b>Your turn to verify.</b> Check the money or slips against these totals. Verifying adds{" "}
              {b.lines.length} entr{b.lines.length === 1 ? "y" : "ies"} to the ledger. After that, mistakes are
              corrected with reversals.
            </div>
            <Button onClick={() => setRejecting(true)}>
              <Undo2 /> Send back
            </Button>
            <Button variant="success" loading={verify.pending} onClick={() => verify.run({ id: b.id })}>
              <CheckCircle2 /> Verify {naira(b.totalKobo)}
            </Button>
          </CardBody>
        </Card>
      )}
      {b.status === "submitted" && !b.canVerify && (
        <Note tone="accent">
          {b.isCounter
            ? verifierRole
              ? "You counted this collection, so someone else must verify it. That's the two-person rule."
              : "Sent for verification. A finance officer will check it next."
            : "Waiting for a finance officer to verify."}
        </Note>
      )}
      {b.status === "draft" && !b.isCounter && <Note>{b.countedByName} is still counting this collection.</Note>}

      <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
        <Card className="col-span-2 max-lg:col-span-1">
          <CardHeader title="Totals" />
          <Table>
            <thead>
              <tr>
                <Th>Fund</Th>
                {channels.map((c) => (
                  <Th key={c} num className="max-sm:hidden">
                    {CHANNELS[c]}
                  </Th>
                ))}
                <Th num>Total</Th>
              </tr>
            </thead>
            <tbody>
              {fundNames.map((f) => (
                <Tr key={f}>
                  <Td className="font-medium">{f}</Td>
                  {channels.map((c) => (
                    <Td key={c} num className="max-sm:hidden">
                      {cell(f, c) ? naira(cell(f, c)) : <span className="text-faint">—</span>}
                    </Td>
                  ))}
                  <Td num className="font-semibold">
                    {naira(channels.reduce((s, c) => s + cell(f, c), 0))}
                  </Td>
                </Tr>
              ))}
              <Tr>
                <Td className="font-semibold">Total</Td>
                {channels.map((c) => (
                  <Td key={c} num className="font-semibold max-sm:hidden">
                    {naira(b.lines.filter((l) => l.channel === c).reduce((s, l) => s + l.amountKobo, 0))}
                  </Td>
                ))}
                <Td num className="text-base font-semibold" data-testid="batch-total">
                  {naira(b.totalKobo)}
                </Td>
              </Tr>
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Who did what" />
          <CardBody className="flex flex-col gap-3 text-[13px]">
            <div>
              <div className="text-xs text-faint">Counted by</div>
              <div className="font-medium">{b.countedByName}</div>
              {b.submittedAt && <div className="text-xs text-muted">Submitted {formatDateTime(b.submittedAt)}</div>}
            </div>
            <div>
              <div className="text-xs text-faint">Verified by</div>
              <div className="font-medium">{b.verifiedByName ?? <span className="text-faint">Not yet</span>}</div>
              {b.verifiedAt && <div className="text-xs text-muted">{formatDateTime(b.verifiedAt)}</div>}
            </div>
            {counted != null && (
              <div>
                <div className="text-xs text-faint">Cash count</div>
                <div className={cn("font-medium", counted === cashTotal ? "text-good" : "text-bad")}>
                  {naira(counted)} counted · {naira(cashTotal)} entered
                </div>
              </div>
            )}
            {b.notes && (
              <div>
                <div className="text-xs text-faint">Notes</div>
                <div>{b.notes}</div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {named.length > 0 && (
        <Card>
          <CardHeader title={`Named gifts (${named.length})`} />
          <Table>
            <thead>
              <tr>
                <Th>Giver</Th>
                <Th>Fund</Th>
                <Th className="max-sm:hidden">How</Th>
                <Th num>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {named.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    {l.name ? (
                      l.memberId ? (
                        <Link href={`/members/${l.memberId}`} className="font-medium hover:text-accent">
                          {l.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{l.name}</span>
                      )
                    ) : (
                      <span className="text-muted">Named gift</span>
                    )}
                  </Td>
                  <Td>{l.fundName}</Td>
                  <Td className="text-muted max-sm:hidden">{CHANNELS[l.channel]}</Td>
                  <Td num>{naira(l.amountKobo)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        {rejecting && (
          <DialogContent
            title="Send back to the counter"
            description={`${b.countedByName} can correct it and submit again.`}
            footer={
              <>
                <Button onClick={() => setRejecting(false)}>Cancel</Button>
                <Button variant="danger" loading={reject.pending} onClick={() => reject.run({ id: b.id, note })}>
                  Send back
                </Button>
              </>
            }
          >
            <Field label="What needs fixing?" htmlFor="rj-note" error={reject.fieldErrors.note}>
              <Textarea
                id="rj-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. The POS slips add up to ₦52,000, not ₦48,000"
              />
            </Field>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
