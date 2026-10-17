"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  Banknote,
  CheckCircle2,
  Circle,
  FileText,
  ImageIcon,
  Lock,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatDateTime, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { getExpense } from "@/server/services/expenses";
import {
  approveExpenseAction,
  deleteExpenseAction,
  payExpenseAction,
  rejectExpenseAction,
  removeFileAction,
  submitExpenseAction,
  voidExpenseAction,
} from "../actions";
import { ExpenseDialog, type Option } from "../expense-form";
import { EXPENSE_STATUS, METHODS } from "../labels";

type E = Awaited<ReturnType<typeof getExpense>>;
type F = { id: string; name: string; mime: string; size: number; uploadedByName: string | null; createdAt: string };

export function ExpenseDetail({
  e,
  files,
  categories,
  funds,
  branches,
}: {
  e: E;
  files: F[];
  categories: Option[];
  funds: (Option & { restricted: boolean })[];
  branches: Option[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | "reject" | "pay" | "void" | "delete">(null);
  const submit = useAction(submitExpenseAction);
  const approve = useAction(approveExpenseAction);
  const st = EXPENSE_STATUS[e.status]!;
  const overBalance = e.fundRestricted && e.fundBalanceKobo !== null && e.status !== "paid" && e.status !== "void" && e.fundBalanceKobo < e.amountKobo;

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/expenses/list">
            <ArrowLeft /> Expenses
          </Link>
        </Button>
      </div>
      <PageHeader
        title={e.payee}
        description={`${e.expenseNo} · ${e.categoryName}${branches.length > 1 ? ` · ${e.branchName}` : ""}`}
        actions={<Badge tone={st.tone}>{st.label}</Badge>}
      />

      {e.status === "rejected" && e.rejectionNote && (
        <Note tone="bad">
          <b>Sent back:</b> {e.rejectionNote}
          {e.isRequester ? " Edit it and submit again." : ""}
        </Note>
      )}
      {e.status === "void" && (
        <Note>
          <b>Voided</b> by {e.voidedByName} on {formatDateTime(e.voidedAt!)}: {e.voidReason}
        </Note>
      )}
      {overBalance && (
        <Note tone="warn">
          {e.fundName} is restricted and holds {naira(e.fundBalanceKobo!)}, less than this expense. Check it&apos;s the right fund before paying.
        </Note>
      )}

      {/* what needs doing next */}
      {e.canApprove && (
        <Card className="border-accent/40">
          <CardBody className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-[13px]">
              <b>Your approval is needed.</b> {e.requestedByName} raised this for {naira(e.amountKobo)}, above the{" "}
              {naira(e.thresholdKobo)} that approves itself.
            </div>
            <Button onClick={() => setDialog("reject")}>
              <Undo2 /> Send back
            </Button>
            <Button variant="success" loading={approve.pending} onClick={() => approve.run({ id: e.id })}>
              <CheckCircle2 /> Approve {naira(e.amountKobo)}
            </Button>
          </CardBody>
        </Card>
      )}
      {e.status === "submitted" && !e.canApprove && (
        <Note tone="accent">
          {e.isRequester
            ? "Sent for approval. Someone other than you who can approve expenses has been emailed."
            : "Waiting for approval."}
        </Note>
      )}
      {e.canPay && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-[13px]">
              <b>Approved.</b> Record the payment once the money has gone out.
            </div>
            {e.canReject && (
              <Button variant="ghost" onClick={() => setDialog("reject")}>
                <Undo2 /> Send back
              </Button>
            )}
            <Button variant="primary" onClick={() => setDialog("pay")}>
              <Banknote /> Mark paid
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Details"
              action={
                e.canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </Button>
                )
              }
            />
            <CardBody>
              <div className="mb-4 flex items-baseline gap-3">
                <span className={cn("tabular text-3xl font-semibold", e.status === "void" && "line-through opacity-60")} data-testid="expense-amount">
                  {naira(e.amountKobo)}
                </span>
                <span className="text-[13px] text-muted">{formatDate(e.spentOn, "long")}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] max-sm:grid-cols-1">
                <Item label="What for" wide>
                  {e.description}
                </Item>
                <Item label="Category">{e.categoryName}</Item>
                <Item label="Paid from">
                  {e.fundName ? (
                    <span className="flex items-center gap-1.5">
                      {e.fundName}
                      {e.fundRestricted && <Lock className="size-3 text-faint" />}
                    </span>
                  ) : (
                    <span className="text-muted">Not charged to a fund</span>
                  )}
                </Item>
                <Item label="Method">{METHODS[e.method]}</Item>
                <Item label="Reference">{e.paymentRef ? <span className="font-mono">{e.paymentRef}</span> : <span className="text-faint">None</span>}</Item>
                {branches.length > 1 && <Item label="Branch">{e.branchName}</Item>}
                {e.note && (
                  <Item label="Notes" wide>
                    <span className="whitespace-pre-wrap">{e.note}</span>
                  </Item>
                )}
              </dl>
            </CardBody>
          </Card>
          <Files e={e} files={files} onChange={() => router.refresh()} />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Who did what" />
            <CardBody>
              <ol className="flex flex-col gap-3 text-[13px]">
                <Step done label={`Raised by ${e.requestedByName}`} when={e.createdAt} />
                <Step done={!!e.submittedAt} label={e.submittedAt ? "Submitted" : "Not submitted yet"} when={e.submittedAt} />
                <Step
                  done={!!e.approvedAt}
                  label={
                    e.approvedAt
                      ? e.autoApproved
                        ? `Approved automatically: within the ${naira(e.thresholdKobo)} limit`
                        : `Approved by ${e.approvedByName}`
                      : "Approval"
                  }
                  when={e.approvedAt}
                />
                <Step done={!!e.paidAt} label={e.paidAt ? `Paid by ${e.paidByName}` : "Payment"} when={e.paidAt} />
                {e.voidedAt && <Step done bad label={`Voided by ${e.voidedByName}`} when={e.voidedAt} />}
              </ol>
            </CardBody>
          </Card>
          <div className="flex flex-wrap gap-2">
            {e.canEdit && (
              <Button variant="primary" loading={submit.pending} onClick={() => submit.run({ id: e.id })}>
                <Send /> Submit
              </Button>
            )}
            {e.canEdit && (
              <Button variant="ghost" onClick={() => setDialog("delete")}>
                <Trash2 /> Delete draft
              </Button>
            )}
            {e.canVoid && (
              <Button variant="ghost" onClick={() => setDialog("void")}>
                <Ban /> Void
              </Button>
            )}
          </div>
        </div>
      </div>

      <ExpenseDialog
        open={editing}
        onOpenChange={setEditing}
        initial={e}
        branches={branches}
        categories={categories}
        funds={funds}
        thresholdKobo={e.thresholdKobo}
      />
      <RejectDialog id={e.id} open={dialog === "reject"} onClose={() => setDialog(null)} />
      <PayDialog e={e} open={dialog === "pay"} onClose={() => setDialog(null)} />
      <VoidDialog e={e} open={dialog === "void"} onClose={() => setDialog(null)} />
      <DeleteDialog id={e.id} open={dialog === "delete"} onClose={() => setDialog(null)} />
    </>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-full" : undefined}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Step({ done, label, when, bad }: { done: boolean; label: string; when: Date | string | null; bad?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      {done ? (
        <CheckCircle2 className={cn("mt-0.5 size-4 shrink-0", bad ? "text-bad" : "text-good")} />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-faint" />
      )}
      <div className={done ? undefined : "text-muted"}>
        {label}
        {when && <div className="text-xs text-faint">{formatDateTime(when)}</div>}
      </div>
    </li>
  );
}

function Files({ e, files, onChange }: { e: E; files: F[]; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const remove = useAction(removeFileAction, { onSuccess: onChange });
  const canAdd = e.status !== "void";
  const canRemove = e.status !== "void" && e.status !== "paid";
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const fd = new FormData();
        fd.set("entityType", "expense");
        fd.set("entityId", e.id);
        fd.set("file", file);
        const res = await fetch("/api/files", { method: "POST", body: fd });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) toast.error(body.error ?? "The upload didn't go through. Try again.");
        else toast.success(`Attached ${file.name}`);
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      onChange();
    }
  };
  return (
    <Card>
      <CardHeader
        title={`Receipts and invoices${files.length ? ` (${files.length})` : ""}`}
        action={
          canAdd && (
            <>
              <input
                ref={input}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                aria-label="Attach receipt"
                onChange={(ev) => upload(ev.target.files)}
              />
              <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
                <Upload /> Attach
              </Button>
            </>
          )
        }
      />
      {files.length === 0 ? (
        <CardBody className="flex items-center gap-3 text-[13px] text-muted">
          <Paperclip className="size-4 shrink-0" />
          {e.status === "paid" ? "No receipt was attached." : "Attach a photo of the receipt or the invoice PDF, up to 10 MB each."}
        </CardBody>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              {f.mime === "application/pdf" ? <FileText className="size-4 shrink-0 text-bad" /> : <ImageIcon className="size-4 shrink-0 text-accent" />}
              <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                {f.name}
              </a>
              <span className="shrink-0 text-xs text-faint max-sm:hidden">
                {(f.size / 1024).toFixed(f.size > 1024 * 1024 ? 0 : 1)} KB · {f.uploadedByName}
              </span>
              {canRemove && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => remove.run({ id: f.id, path: `/expenses/${e.id}` })}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RejectDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const act = useAction(rejectExpenseAction, { onSuccess: onClose });
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Send back"
          description="Whoever raised it can fix it and submit again."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="danger" loading={act.pending} onClick={() => act.run({ id, note })}>
                <Undo2 /> Send back
              </Button>
            </>
          }
        >
          <Field label="What needs fixing?" htmlFor="rj" error={act.fieldErrors.note}>
            <Textarea id="rj" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. Attach the invoice from the vendor" />
          </Field>
        </DialogContent>
      )}
    </Dialog>
  );
}

function PayDialog({ e, open, onClose }: { e: E; open: boolean; onClose: () => void }) {
  const act = useAction(payExpenseAction, { onSuccess: onClose });
  const [method, setMethod] = useState(e.method);
  const [ref, setRef] = useState(e.paymentRef ?? "");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title={`Mark ${naira(e.amountKobo)} paid?`}
          description={`To ${e.payee}. After this the expense can't be edited, only voided.`}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={act.pending} onClick={() => act.run({ id: e.id, method, paymentRef: ref })}>
                <Banknote /> Mark paid
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="Paid by" htmlFor="pm">
              <Select id="pm" value={method} onChange={(ev) => setMethod(ev.target.value as E["method"])}>
                {Object.entries(METHODS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="pr" error={act.fieldErrors.paymentRef} optional={method === "cash"}>
              <Input id="pr" value={ref} onChange={(ev) => setRef(ev.target.value)} placeholder="Transfer or cheque number" />
            </Field>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function VoidDialog({ e, open, onClose }: { e: E; open: boolean; onClose: () => void }) {
  const act = useAction(voidExpenseAction, { onSuccess: onClose });
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title={`Void ${e.expenseNo}?`}
          description="The expense stays on record, marked voided, and stops counting in the accounts. This can't be undone."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="danger" loading={act.pending} onClick={() => act.run({ id: e.id, reason })}>
                <Ban /> Void
              </Button>
            </>
          }
        >
          {e.status === "paid" && <Note tone="warn">This was paid. Voiding it doesn&apos;t get the money back.</Note>}
          <Field label="Why?" htmlFor="vr" error={act.fieldErrors.reason}>
            <Textarea id="vr" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Field>
        </DialogContent>
      )}
    </Dialog>
  );
}

function DeleteDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const act = useAction(deleteExpenseAction, { onSuccess: () => router.push("/expenses/list") });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Delete this draft?"
          footer={
            <>
              <Button onClick={onClose}>Keep it</Button>
              <Button variant="danger" loading={act.pending} onClick={() => act.run({ id })}>
                <Trash2 /> Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-muted">It was never approved, so nothing else changes. The audit log keeps a note that it existed.</p>
        </DialogContent>
      )}
    </Dialog>
  );
}
