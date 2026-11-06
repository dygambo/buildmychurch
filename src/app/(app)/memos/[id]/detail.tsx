"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Circle,
  Eye,
  FileText,
  HelpCircle,
  ImageIcon,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  Undo2,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatDateTime, naira, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MemoDetail } from "@/server/services/memos";
import {
  answerQueryAction,
  approveMemoAction,
  commentAction,
  declineMemoAction,
  deleteDraftAction,
  disburseAction,
  queryMemoAction,
  submitMemoAction,
  withdrawMemoAction,
} from "../actions";
import { CATEGORY, STATUS } from "../labels";

type F = { id: string; name: string; mime: string; size: number; uploadedByName: string | null; createdAt: string };

export function MemoDetailView({
  m,
  files,
  categories,
  funds,
  church,
  canSeeMembers,
}: {
  m: MemoDetail;
  files: F[];
  categories: { id: string; name: string }[];
  funds: { id: string; name: string }[];
  church: string;
  canSeeMembers: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "query" | "decline" | "answer" | "withdraw" | "pay" | "delete">(null);
  const [comment, setComment] = useState("");
  const approve = useAction(approveMemoAction, { onSuccess: () => router.refresh() });
  const submit = useAction(submitMemoAction, { onSuccess: () => router.refresh() });
  const post = useAction(commentAction, {
    onSuccess: () => {
      setComment("");
      router.refresh();
    },
  });
  const current = m.steps.find((s) => s.position === m.currentStep);
  const st = m.status === "pending" && current?.openedAt ? STATUS.review! : STATUS[m.status]!;
  const [approveNote, setApproveNote] = useState("");

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/memos">
            <ArrowLeft /> E-Memo
          </Link>
        </Button>
        {m.refNo && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`/memos/${m.id}/pdf`} target="_blank" rel="noopener">
              <FileText /> PDF with stamps
            </a>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        {m.urgent && (
          <Badge tone="bad">
            <AlertTriangle className="size-3" /> Urgent
          </Badge>
        )}
        {m.confidential && (
          <Badge>
            <Lock className="size-3" /> Confidential
          </Badge>
        )}
        {m.disbursedAt && <Badge tone="good">Paid {naira(m.disbursedKobo!)}</Badge>}
      </div>

      {m.status === "query" && (
        <Note tone="warn" icon={<HelpCircle className="size-4" />}>
          <b>{current?.label} asked:</b> {current?.comment}
          {m.isMine && " Update the memo if needed, then answer the query."}
        </Note>
      )}
      {m.canAct && (
        <Card className="border-accent/40">
          <CardBody className="flex flex-col gap-3">
            <div className="text-[13px]">
              <b>Your approval is needed</b> as {current?.label}.{" "}
              {m.amountKobo ? `${m.initiatorName} is asking for ${naira(m.amountKobo)}.` : ""}
            </div>
            <Input aria-label="Comment with your approval" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="Comment (optional)" />
            <div className="flex flex-wrap gap-2">
              <Button variant="success" loading={approve.pending} onClick={() => approve.run({ id: m.id, comment: approveNote })}>
                <CheckCircle2 /> Approve
              </Button>
              <Button onClick={() => setDialog("query")}>
                <HelpCircle /> Query
              </Button>
              <Button variant="ghost" onClick={() => setDialog("decline")}>
                <XCircle /> Decline
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      {m.canDisburse && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-[13px]">
              <b>Cleared for payment.</b> Record the payment once {naira(m.amountKobo!)} has gone out.
            </div>
            <Button variant="primary" onClick={() => setDialog("pay")}>
              <Banknote /> Record payment
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3 border-b-2 border-accent pb-3">
                <div>
                  <div className="text-xs font-semibold tracking-wider text-accent uppercase">Internal memo</div>
                  <div className="font-semibold">{church}</div>
                </div>
                <div className="text-right font-mono text-xs text-muted" data-testid="memo-ref">
                  {m.refNo ?? "Draft"}
                </div>
              </div>
              <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted">From</dt>
                <dd>
                  {m.initiatorName}
                  {m.departmentName ? `, ${m.departmentName}` : ""}
                </dd>
                <dt className="text-muted">To</dt>
                <dd>{m.steps.length ? m.steps.map((s) => s.label).join(" → ") : "Not sent yet"}</dd>
                <dt className="text-muted">Date</dt>
                <dd>{formatDate(m.submittedAt ?? m.createdAt, "long")}</dd>
                <dt className="text-muted">Kind</dt>
                <dd>{CATEGORY[m.category]}</dd>
                {m.amountKobo && (
                  <>
                    <dt className="text-muted">Amount</dt>
                    <dd className="tabular text-base font-semibold">{naira(m.amountKobo)}</dd>
                  </>
                )}
                {m.member && (
                  <>
                    <dt className="text-muted">Member</dt>
                    <dd>
                      {canSeeMembers ? (
                        <Link href={`/members/${m.member.id}`} className="text-accent">
                          {m.member.firstName} {m.member.lastName}
                        </Link>
                      ) : (
                        `${m.member.firstName} ${m.member.lastName}`
                      )}{" "}
                      <span className="font-mono text-xs text-faint">{m.member.memberNo}</span>
                    </dd>
                  </>
                )}
              </dl>
              <h1 className="text-lg font-semibold">{m.title}</h1>
              <div className="text-[14px] leading-relaxed whitespace-pre-wrap">{m.body}</div>
              {m.steps.some((s) => s.stamp) && (
                <div className="flex flex-wrap gap-3 border-t border-line pt-4">
                  {m.steps
                    .filter((s) => s.stamp)
                    .map((s) => (
                      <Stamp key={s.id} s={s.stamp!} />
                    ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Attachments memoId={m.id} files={files} canAdd={["draft", "pending", "query"].includes(m.status) && (m.isMine || m.canAct)} onChange={() => router.refresh()} />
          <Card>
            <CardHeader title="Conversation" />
            <CardBody className="flex flex-col gap-3">
              <ul className="flex flex-col gap-3">
                {m.comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5 text-[13px]">
                    <span
                      className={cn(
                        "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                        c.kind === "approved" ? "bg-good-soft text-good" : c.kind === "declined" ? "bg-bad-soft text-bad" : c.kind === "query" ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted",
                      )}
                    >
                      {c.kind === "approved" ? <CheckCircle2 className="size-3.5" /> : c.kind === "declined" ? <XCircle className="size-3.5" /> : c.kind === "query" ? <HelpCircle className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div>
                        <b>{c.authorName}</b>{" "}
                        <span className="text-muted">
                          {{ approved: "approved", declined: "declined", query: "raised a query", response: "answered", submitted: "sent it", withdrawn: "withdrew it", disbursed: "recorded payment", comment: "commented", skipped: "skipped" }[c.kind]}
                        </span>{" "}
                        <span className="text-xs text-faint">{timeAgo(c.createdAt)}</span>
                      </div>
                      {c.body && <p className="whitespace-pre-wrap">{c.body}</p>}
                    </div>
                  </li>
                ))}
              </ul>
              {m.status !== "draft" && (
                <div className="flex gap-2">
                  <Input aria-label="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" onKeyDown={(e) => e.key === "Enter" && comment.trim() && post.run({ id: m.id, body: comment })} />
                  <Button loading={post.pending} disabled={!comment.trim()} onClick={() => post.run({ id: m.id, body: comment })}>
                    Post
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Approval path" />
            <CardBody>
              <ol className="flex flex-col gap-3 text-[13px]" data-testid="approval-path">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
                  <div>
                    Raised by {m.initiatorName}
                    <div className="text-xs text-faint">{formatDateTime(m.submittedAt ?? m.createdAt)}</div>
                  </div>
                </li>
                {m.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2.5">
                    {s.status === "approved" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
                    ) : s.status === "declined" ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />
                    ) : s.status === "queried" ? (
                      <HelpCircle className="mt-0.5 size-4 shrink-0 text-warn" />
                    ) : s.status === "current" ? (
                      <Circle className="mt-0.5 size-4 shrink-0 fill-accent-soft text-accent" />
                    ) : (
                      <Circle className="mt-0.5 size-4 shrink-0 text-faint" />
                    )}
                    <div className={s.status === "waiting" || s.status === "skipped" ? "text-muted" : undefined}>
                      <span className="font-medium">{s.label}</span>
                      {s.actedByName && <span>: {s.actedByName}</span>}
                      <div className="text-xs text-faint">
                        {s.actedAt
                          ? formatDateTime(s.actedAt)
                          : s.status === "current"
                            ? s.openedAt
                              ? `Under review since ${formatDateTime(s.openedAt)}`
                              : "Waiting"
                            : s.status === "queried"
                              ? "Waiting for an answer"
                              : s.status === "skipped"
                                ? "Not needed"
                                : "Next"}
                      </div>
                      {s.comment && s.status !== "queried" && <div className="text-xs text-muted">“{s.comment}”</div>}
                    </div>
                  </li>
                ))}
                {m.amountKobo && m.status === "approved" && (
                  <li className="flex items-start gap-2.5">
                    {m.disbursedAt ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <Circle className="mt-0.5 size-4 shrink-0 text-faint" />}
                    <div>
                      <span className="font-medium">Payment</span>
                      {m.disbursedByName && <span>: {m.disbursedByName}</span>}
                      <div className="text-xs text-faint">
                        {m.disbursedAt ? `${naira(m.disbursedKobo!)} on ${formatDate(m.disbursedAt)}${m.disbursementRef ? ` · ${m.disbursementRef}` : ""}` : "Waiting for finance"}
                      </div>
                      {m.expense && (
                        <Link href={`/expenses/${m.expense.id}`} className="text-xs text-accent">
                          Expense {m.expense.expenseNo}
                        </Link>
                      )}
                    </div>
                  </li>
                )}
              </ol>
            </CardBody>
          </Card>
          <div className="flex flex-wrap gap-2">
            {m.status === "draft" && m.isMine && (
              <>
                <Button variant="primary" loading={submit.pending} onClick={() => submit.run({ id: m.id })}>
                  <Send /> Send for approval
                </Button>
                <Button asChild>
                  <Link href={`/memos/new?edit=${m.id}`}>
                    <Pencil /> Edit
                  </Link>
                </Button>
                <Button variant="ghost" onClick={() => setDialog("delete")}>
                  <Trash2 /> Delete
                </Button>
              </>
            )}
            {m.status === "query" && m.isMine && (
              <>
                <Button variant="primary" onClick={() => setDialog("answer")}>
                  <Send /> Answer the query
                </Button>
                <Button asChild>
                  <Link href={`/memos/new?edit=${m.id}`}>
                    <Pencil /> Update the memo
                  </Link>
                </Button>
              </>
            )}
            {m.canWithdraw && (
              <Button variant="ghost" onClick={() => setDialog("withdraw")}>
                <Undo2 /> Withdraw
              </Button>
            )}
          </div>
          {m.views.length > 0 && (
            <Card>
              <CardHeader title="Opened by" />
              <CardBody className="flex flex-col gap-1.5 text-[13px]">
                {m.views.map((v) => (
                  <div key={v.userId} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <Eye className="size-3.5 text-faint" /> {v.userName}
                    </span>
                    <span className="text-xs text-faint">
                      {timeAgo(v.lastAt)}
                      {v.count > 1 ? ` · ${v.count} times` : ""}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ReasonDialog
        open={dialog === "query"}
        onClose={() => setDialog(null)}
        title="Raise a query"
        description="The memo goes back to the initiator. It returns to you when they answer."
        label="Your question"
        placeholder="e.g. Please provide three quotes for this repair"
        action={queryMemoAction}
        id={m.id}
        button="Send query"
      />
      <ReasonDialog
        open={dialog === "decline"}
        onClose={() => setDialog(null)}
        title="Decline this memo?"
        description="This ends the memo. The initiator is told why."
        label="Reason"
        action={declineMemoAction}
        id={m.id}
        button="Decline"
        danger
      />
      <ReasonDialog
        open={dialog === "answer"}
        onClose={() => setDialog(null)}
        title="Answer the query"
        description="Update the memo first if they asked for changes. Your answer sends it back to the approver."
        label="Your answer"
        action={answerQueryAction}
        id={m.id}
        button="Send answer"
      />
      <ReasonDialog open={dialog === "withdraw"} onClose={() => setDialog(null)} title="Withdraw this memo?" description="It stops here and stays on record as withdrawn." label="Why?" action={withdrawMemoAction} id={m.id} button="Withdraw" danger />
      <PayDialog open={dialog === "pay"} onClose={() => setDialog(null)} m={m} categories={categories} funds={funds} />
      <DeleteDialog open={dialog === "delete"} onClose={() => setDialog(null)} id={m.id} />
    </>
  );
}

function Stamp({ s }: { s: { name: string; label: string; at: string; code: string } }) {
  return (
    <div className="relative grid size-28 -rotate-6 place-items-center rounded-full border-[3px] border-double border-good/70 p-2 text-center text-good" data-testid="stamp">
      <div className="text-[9px] font-bold tracking-widest uppercase">Approved</div>
      <div className="text-[10px] leading-tight font-semibold">{s.name}</div>
      <div className="text-[8px] leading-tight uppercase">{s.label}</div>
      <div className="text-[8px]">{formatDate(s.at)}</div>
      <div className="font-mono text-[7px] opacity-70">{s.code}</div>
    </div>
  );
}

function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label,
  placeholder,
  action,
  id,
  button,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  label: string;
  placeholder?: string;
  action: typeof queryMemoAction;
  id: string;
  button: string;
  danger?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const act = useAction(action, {
    onSuccess: () => {
      setText("");
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title={title}
          description={description}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant={danger ? "danger" : "primary"} loading={act.pending} onClick={() => act.run({ id, comment: text })}>
                {button}
              </Button>
            </>
          }
        >
          <Field label={label} htmlFor="rsn" error={act.fieldErrors.comment}>
            <Textarea id="rsn" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
          </Field>
        </DialogContent>
      )}
    </Dialog>
  );
}

function PayDialog({ open, onClose, m, categories, funds }: { open: boolean; onClose: () => void; m: MemoDetail; categories: { id: string; name: string }[]; funds: { id: string; name: string }[] }) {
  const router = useRouter();
  const act = useAction(disburseAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title={`Record payment for ${m.refNo}`}
          description={`Approved: ${naira(m.amountKobo ?? 0)}.`}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="pay-form" variant="primary" loading={act.pending}>
                <Banknote /> Record payment
              </Button>
            </>
          }
        >
          <form
            id="pay-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act.run({
                id: m.id,
                amount: String(f.get("amount")),
                method: String(f.get("method")) as "transfer",
                reference: String(f.get("reference") ?? ""),
                categoryId: String(f.get("categoryId") ?? ""),
                fundId: String(f.get("fundId") ?? ""),
              });
            }}
          >
            <Field label="Amount paid (₦)" htmlFor="pd-amt" error={act.fieldErrors.amount}>
              <Input id="pd-amt" name="amount" inputMode="decimal" defaultValue={String((m.amountKobo ?? 0) / 100)} />
            </Field>
            <Field label="How" htmlFor="pd-m">
              <Select id="pd-m" name="method" defaultValue="transfer">
                <option value="transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="pos">POS / card</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Reference" htmlFor="pd-ref" error={act.fieldErrors.reference} className="col-span-full">
              <Input id="pd-ref" name="reference" placeholder="Transfer or cheque number" />
            </Field>
            <Field label="Add to expenses as" htmlFor="pd-cat" optional hint="Records it in the expense ledger as paid.">
              <Select id="pd-cat" name="categoryId" defaultValue="">
                <option value="">Don&apos;t add to expenses</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid from fund" htmlFor="pd-fund" optional>
              <Select id="pd-fund" name="fundId" defaultValue="">
                <option value="">Not charged to a fund</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function DeleteDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const router = useRouter();
  const act = useAction(deleteDraftAction, { onSuccess: () => router.push("/memos") });
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
          <p className="text-[13px] text-muted">It was never sent, so no one else has seen it.</p>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Attachments({ memoId, files, canAdd, onChange }: { memoId: string; files: F[]; canAdd: boolean; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const fd = new FormData();
        fd.set("entityType", "memo");
        fd.set("entityId", memoId);
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
  if (!files.length && !canAdd) return null;
  return (
    <Card>
      <CardHeader
        title={`Attachments${files.length ? ` (${files.length})` : ""}`}
        action={
          canAdd && (
            <>
              <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Attach a file" onChange={(e) => upload(e.target.files)} />
              <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
                <Upload /> Attach
              </Button>
            </>
          )
        }
      />
      {files.length === 0 ? (
        <CardBody className="flex items-center gap-2 text-[13px] text-muted">
          <Paperclip className="size-4" /> Attach quotes, receipts or letters (PDF or photo, up to 10 MB).
        </CardBody>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              {f.mime === "application/pdf" ? <FileText className="size-4 text-bad" /> : <ImageIcon className="size-4 text-accent" />}
              <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                {f.name}
              </a>
              <span className="text-xs text-faint">{f.uploadedByName}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
