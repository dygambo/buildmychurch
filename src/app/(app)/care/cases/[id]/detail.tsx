"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, HandCoins, Lock, MapPin, MessageSquareText, Pencil, Phone, PhoneCall, Footprints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { formatDate, naira, timeAgo, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { getCase } from "@/server/services/care";
import { addEntryAction, closeCaseAction, reopenCaseAction } from "../../actions";
import { CARE_LABEL, ENTRY_LABEL, PRIORITY, WELFARE_LABEL } from "../../labels";
import { CaseDialog } from "../../view";

type C = Awaited<ReturnType<typeof getCase>>;
type Kind = "note" | "visit" | "call" | "welfare";

const ICON: Record<Kind, React.ReactNode> = {
  note: <MessageSquareText className="size-4" />,
  visit: <Footprints className="size-4" />,
  call: <PhoneCall className="size-4" />,
  welfare: <HandCoins className="size-4" />,
};

export function CaseDetail({ c, team, pastor }: { c: C; team: { id: string; name: string }[]; pastor: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const refresh = { onSuccess: () => router.refresh() };
  const reopen = useAction(reopenCaseAction, refresh);
  const close = useAction(closeCaseAction, {
    onSuccess: () => {
      setClosing(false);
      router.refresh();
    },
  });
  const pr = PRIORITY[c.priority];
  const today = todayISO();
  const open = c.status === "open";
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/care?tab=cases">
            <ArrowLeft /> Pastoral care
          </Link>
        </Button>
      </div>
      <PageHeader
        title={c.member.name}
        description={`${CARE_LABEL[c.kind]} · ${c.title}`}
        actions={
          <>
            {c.priority !== "normal" && <Badge tone={pr.tone}>{pr.label}</Badge>}
            {c.confidential && (
              <Badge tone="warn">
                <Lock className="size-3" /> Pastors only
              </Badge>
            )}
            {!open && <Badge>Closed</Badge>}
            {open ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button onClick={() => setClosing(true)}>Close record</Button>
              </>
            ) : (
              <Button loading={reopen.pending} onClick={() => reopen.run({ id: c.id })}>
                Reopen
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-[1fr_320px] gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          {open && (
            <Card>
              <CardBody className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[13px] font-medium">Record</span>
                {(["visit", "call", "welfare", "note"] as const).map((k) => (
                  <Button key={k} size="sm" variant={k === "visit" ? "primary" : "secondary"} onClick={() => setKind(k)}>
                    {ICON[k]} {k === "welfare" ? "Welfare given" : `A ${ENTRY_LABEL[k].toLowerCase()}`}
                  </Button>
                ))}
              </CardBody>
            </Card>
          )}
          {open && (c.nextAction || c.nextActionOn) && (
            <Note tone={c.nextActionOn && c.nextActionOn <= today ? "bad" : undefined} icon={<CalendarClock className="size-4" />}>
              <span className="font-medium">Next: {c.nextAction ?? "Follow up"}</span>
              {c.nextActionOn && ` · ${c.nextActionOn < today ? `overdue since ${formatDate(c.nextActionOn, "short")}` : c.nextActionOn === today ? "today" : formatDate(c.nextActionOn, "week")}`}
              {c.assignedName && ` · ${c.assignedName}`}
            </Note>
          )}
          {!open && c.closedNote && <Note>Closed {c.closedAt ? formatDate(c.closedAt) : ""}: {c.closedNote}</Note>}
          <Card>
            <CardHeader title="History" />
            {c.entries.length === 0 ? (
              <EmptyState title="Nothing recorded yet">Record each visit, call and welfare gift so the whole team knows how they're doing.</EmptyState>
            ) : (
              <ol className="flex flex-col" data-testid="care-history">
                {c.entries.map((e) => (
                  <li key={e.id} className="flex gap-3 border-t border-line px-4 py-3 first:border-t-0">
                    <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", e.kind === "welfare" ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>{ICON[e.kind]}</span>
                    <div className="min-w-0 flex-1 text-[13px]">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">
                          {e.kind === "welfare" ? `${WELFARE_LABEL[e.welfareKind ?? "other"]}${e.amountKobo ? `: ${naira(e.amountKobo)}` : ""}` : ENTRY_LABEL[e.kind]}
                        </span>
                        <span className="text-xs text-faint">
                          {formatDate(e.happenedOn, "week")} · {e.authorName}
                        </span>
                      </div>
                      {e.body && <p className="mt-0.5 whitespace-pre-wrap text-muted">{e.body}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Contact" action={<Link href={`/members/${c.member.id}`} className="text-xs text-accent">Profile</Link>} />
            <CardBody className="flex flex-col gap-2 text-[13px]">
              {c.member.phone && (
                <a href={`tel:${c.member.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 hover:text-accent">
                  <Phone className="size-4 text-faint" /> {c.member.phone}
                </a>
              )}
              {(c.member.address || c.member.area) && (
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-faint" /> {c.member.address ?? c.member.area}
                </span>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="About" />
            <CardBody className="flex flex-col gap-2 text-[13px]">
              {c.summary ? <p className="whitespace-pre-wrap">{c.summary}</p> : <p className="text-faint">No details added.</p>}
              {c.prayer && (
                <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                  <div className="font-medium text-muted">Prayer request, {timeAgo(c.prayer.createdAt)}</div>
                  <p className="mt-0.5 italic">{c.prayer.body}</p>
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-faint">Looking after</dt>
                <dd>{c.assignedName ?? "No one yet"}</dd>
                <dt className="text-faint">Opened</dt>
                <dd>
                  {formatDate(c.createdAt)} by {c.openedByName}
                </dd>
                <dt className="text-faint">Welfare given</dt>
                <dd className="font-medium">{naira(c.welfareKobo)}</dd>
              </dl>
            </CardBody>
          </Card>
          {c.others.length > 0 && (
            <Card>
              <CardHeader title="Earlier care" />
              <ul className="flex flex-col text-[13px]">
                {c.others.map((o) => (
                  <li key={o.id} className="border-t border-line px-4 py-2">
                    <Link href={`/care/cases/${o.id}`} className="hover:text-accent">
                      {CARE_LABEL[o.kind]}: {o.title}
                    </Link>
                    <div className="text-xs text-faint">
                      {formatDate(o.createdAt, "short")} · {o.status === "open" ? "Open" : "Closed"}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <EntryDialog kind={kind} onClose={() => setKind(null)} caseId={c.id} nextAction={c.nextAction} />
      <CaseDialog
        target={editing ? {} : null}
        onClose={() => setEditing(false)}
        team={team}
        pastor={pastor}
        initial={{
          id: c.id,
          memberId: c.member.id,
          memberName: c.member.name,
          kind: c.kind,
          title: c.title,
          summary: c.summary,
          priority: c.priority,
          confidential: c.confidential,
          assignedTo: c.assignedTo,
          nextActionOn: c.nextActionOn,
          nextAction: c.nextAction,
        }}
      />
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent
          title="Close this record?"
          description="It moves to Closed and stays in their history. You can reopen it."
          footer={
            <>
              <Button onClick={() => setClosing(false)}>Keep open</Button>
              <Button type="submit" form="close-case" variant="primary" loading={close.pending}>
                Close record
              </Button>
            </>
          }
        >
          <form
            id="close-case"
            onSubmit={(e) => {
              e.preventDefault();
              close.run({ id: c.id, note: String(new FormData(e.currentTarget).get("note") ?? "") });
            }}
          >
            <Field label="How things ended" htmlFor="cl-note" optional>
              <Textarea id="cl-note" name="note" rows={2} placeholder="e.g. Discharged and back in church" />
            </Field>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EntryDialog({ kind, onClose, caseId, nextAction }: { kind: Kind | null; onClose: () => void; caseId: string; nextAction: string | null }) {
  const router = useRouter();
  const act = useAction(addEntryAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const fe = act.fieldErrors;
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      {kind && (
        <DialogContent
          title={kind === "welfare" ? "Record welfare given" : `Record a ${ENTRY_LABEL[kind].toLowerCase()}`}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="entry-form" variant="primary" loading={act.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="entry-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const g = (k: string) => String(f.get(k) ?? "");
              const changeNext = f.get("setNext") === "on";
              act.run({
                caseId,
                kind,
                body: g("body"),
                happenedOn: g("happenedOn"),
                amount: g("amount"),
                welfareKind: (g("welfareKind") || null) as never,
                ...(changeNext ? { nextActionOn: g("nextActionOn") || null, nextAction: g("nextAction") || null } : {}),
              });
            }}
          >
            {kind === "welfare" && (
              <>
                <Field label="What was given" htmlFor="en-wk" error={fe.welfareKind}>
                  <Select id="en-wk" name="welfareKind" defaultValue="cash">
                    {Object.entries(WELFARE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount or value (₦)" htmlFor="en-amt" error={fe.amount}>
                  <Input id="en-amt" name="amount" inputMode="decimal" placeholder="e.g. 50,000" />
                </Field>
              </>
            )}
            <Field label="When" htmlFor="en-on" error={fe.happenedOn}>
              <Input id="en-on" name="happenedOn" type="date" max={todayISO()} defaultValue={todayISO()} />
            </Field>
            <Field label={kind === "welfare" ? "Note" : "What happened"} htmlFor="en-body" error={fe.body} optional={kind === "welfare"} className="col-span-full">
              <Textarea id="en-body" name="body" rows={3} placeholder={kind === "visit" ? "Who went, how they are, what they need" : kind === "call" ? "What you talked about" : kind === "welfare" ? "e.g. Paid directly to the hospital" : ""} />
            </Field>
            <details className="col-span-full rounded-lg border border-line px-3 py-2 text-[13px]" open={kind !== "note"}>
              <summary className="cursor-pointer font-medium">Next step</summary>
              <input type="hidden" name="setNext" value="on" />
              <div className="mt-2 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="By" htmlFor="en-next-on" optional>
                  <Input id="en-next-on" name="nextActionOn" type="date" min={todayISO()} />
                </Field>
                <Field label="What" htmlFor="en-next" optional>
                  <Input id="en-next" name="nextAction" defaultValue={nextAction ?? ""} placeholder="Leave empty if nothing is planned" />
                </Field>
              </div>
            </details>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
