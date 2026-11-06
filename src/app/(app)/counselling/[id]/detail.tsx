"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Award, CalendarPlus, CheckCircle2, Lock, MapPin, MoreHorizontal, Pause, Pencil, Phone, Play, Plus, UserRoundCog, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatTime, todayISO } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { CaseDetail } from "@/server/services/counselling";
import { addChecklistAction, assignAction, checklistAction, completeAction, recordAction, sessionAction, statusAction } from "../actions";
import { CaseDialog } from "../case-dialog";
import { KIND_LABEL, OUTCOME_LABEL, SESSION_STATUS, STATUS } from "../labels";

type Session = CaseDetail["sessions"][number];
const toLocal = (d: Date) => new Date(new Date(d).getTime() + 3600_000).toISOString().slice(0, 16);
const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${todayISO()}T12:00:00Z`)) / 86_400_000);

export function CaseDetailView({ c, team, branches, canOversee, me, now }: { c: CaseDetail; team: { id: string; name: string }[]; branches: { id: string; name: string }[]; canOversee: boolean; me: string; now: number }) {
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };
  const status = useAction(statusAction, refresh);
  // ticks show straight away; the server confirms in the background
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const check = useAction(checklistAction, { onSuccess: () => router.refresh(), onError: () => setTicked({}) });
  const [planning, setPlanning] = useState<{ session?: Session } | null>(null);
  const [recording, setRecording] = useState<Session | null>(null);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const st = STATUS[c.status];
  const open = c.status !== "completed" && c.status !== "closed";
  const held = c.sessions.filter((s) => s.status === "held").length;
  const usedTopics = new Set(c.sessions.filter((s) => s.status !== "cancelled").map((s) => s.topic));
  const nextTopic = c.topics.find((t) => !usedTopics.has(t)) ?? "";
  const isDone = (x: { key: string; done: boolean }) => ticked[x.key] ?? x.done;
  const checklistDone = c.checklist.filter(isDone).length;
  const wedding = c.weddingDate ? daysUntil(c.weddingDate) : null;
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/counselling">
            <ArrowLeft /> Marriage counselling
          </Link>
        </Button>
      </div>
      <PageHeader
        title={`${c.a.name} & ${c.b.name}`}
        description={`${KIND_LABEL[c.kind]} counselling · ${c.refNo}${c.source === "online" ? " · requested online" : ""}`}
        actions={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone="warn">
              <Lock className="size-3" /> Confidential
            </Badge>
            {c.certificateNo && (
              <Button asChild>
                <a href={`/counselling/${c.id}/certificate`} target="_blank" rel="noopener">
                  <Award /> Certificate
                </a>
              </Button>
            )}
            {open && (
              <Button variant="primary" onClick={() => setPlanning({})} disabled={!c.counsellorIds.length}>
                <CalendarPlus /> Plan a session
              </Button>
            )}
            <Dropdown>
              <DropdownTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end">
                <DropdownItem onSelect={() => setEditing(true)}>
                  <Pencil /> Edit details
                </DropdownItem>
                {canOversee && (
                  <DropdownItem onSelect={() => setAssigning(true)}>
                    <UserRoundCog /> Change counsellors
                  </DropdownItem>
                )}
                {open && c.status !== "on_hold" && c.status !== "enquiry" && (
                  <DropdownItem onSelect={() => status.run({ id: c.id, status: "on_hold" })}>
                    <Pause /> Put on hold
                  </DropdownItem>
                )}
                {(c.status === "on_hold" || c.status === "closed") && (
                  <DropdownItem onSelect={() => status.run({ id: c.id, status: "active" })}>
                    <Play /> Resume
                  </DropdownItem>
                )}
                {open && (
                  <>
                    <DropdownSeparator />
                    <DropdownItem onSelect={() => setCompleting(true)}>
                      <CheckCircle2 /> Complete counselling
                    </DropdownItem>
                    <DropdownItem danger onSelect={() => status.run({ id: c.id, status: "closed" })}>
                      <XCircle /> Close without completing
                    </DropdownItem>
                  </>
                )}
              </DropdownContent>
            </Dropdown>
          </>
        }
      />
      {c.status === "enquiry" && (
        <Note>
          {c.counsellorIds.length
            ? "Plan the first session to start counselling."
            : canOversee
              ? "This couple is waiting for a counsellor. Use Change counsellors in the ⋯ menu."
              : "A pastor will assign a counsellor."}
        </Note>
      )}
      {c.status === "completed" && (
        <Note tone="good" icon={<CheckCircle2 className="size-4" />}>
          Completed {c.completedAt ? formatDate(c.completedAt) : ""}: {c.outcome ? OUTCOME_LABEL[c.outcome] : ""}
          {c.certificateNo ? `. Certificate ${c.certificateNo}.` : "."}
          {c.summary && <span className="mt-1 block text-fg">{c.summary}</span>}
        </Note>
      )}

      <div className="grid grid-cols-[1fr_340px] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="Sessions"
              action={
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (held / Math.max(1, c.plannedSessions)) * 100)}%` }} />
                  </span>
                  {held} of {c.plannedSessions} held
                </span>
              }
            />
            {c.sessions.length === 0 ? (
              <EmptyState
                title="No sessions yet"
                action={
                  open && c.counsellorIds.length ? (
                    <Button onClick={() => setPlanning({})}>
                      <CalendarPlus /> Plan the first session
                    </Button>
                  ) : null
                }
              >
                {c.kind === "premarital" ? "Most pre-marital courses run 8 to 11 weekly sessions." : "Start by listening to both of them, together or one at a time."}
              </EmptyState>
            ) : (
              <ol className="flex flex-col" data-testid="sessions">
                {c.sessions.map((s, i) => {
                  const ss = SESSION_STATUS[s.status];
                  const due = s.status === "scheduled" && new Date(s.startsAt).getTime() < now + 3600_000;
                  return (
                    <li key={s.id} className={cn("flex gap-3 border-t border-line px-4 py-3 first:border-t-0", s.status === "cancelled" && "opacity-60")}>
                      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", s.status === "held" ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>{i + 1}</span>
                      <div className="min-w-0 flex-1 text-[13px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{s.topic}</span>
                          <Badge tone={ss.tone}>{ss.label}</Badge>
                          {s.attended && s.attended !== "both" && s.status === "held" && <span className="text-xs text-warn">{s.attended === "a" ? `Only ${c.a.name.split(" ")[0]} came` : s.attended === "b" ? `Only ${c.b.name.split(" ")[0]} came` : "Neither came"}</span>}
                        </div>
                        <div className="text-xs text-muted">
                          {formatDate(s.startsAt, "week")}, {formatTime(s.startsAt)} · {s.durationMin} min{s.location ? ` · ${s.location}` : ""}
                          {s.counsellorName ? ` · ${s.counsellorName}` : ""}
                        </div>
                        {s.notes && (
                          <p className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 whitespace-pre-wrap">
                            <span className="mr-1 text-xs font-medium text-faint">Private notes</span>
                            {s.notes}
                          </p>
                        )}
                        {s.homework && (
                          <p className="mt-1.5 text-xs text-muted">
                            <span className="font-medium">Homework:</span> {s.homework}
                          </p>
                        )}
                      </div>
                      {s.status === "scheduled" && open && (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Button size="sm" variant={due ? "primary" : "ghost"} onClick={() => setRecording(s)}>
                            {due ? "Record" : "Record or cancel"}
                          </Button>
                          {!due && (
                            <Button size="sm" variant="ghost" onClick={() => setPlanning({ session: s })}>
                              Move
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
          {c.reason && (
            <Card>
              <CardHeader title={c.kind === "premarital" ? "Notes from the first conversation" : "Why they came"} />
              <CardBody>
                <p className="text-[13px] whitespace-pre-wrap">{c.reason}</p>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="The couple" />
            <CardBody className="flex flex-col gap-3 text-[13px]">
              {[c.a, c.b].map((p, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  {p.memberId ? (
                    <Link href={`/members/${p.memberId}`} className="font-medium hover:text-accent">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="font-medium">
                      {p.name} <span className="text-xs font-normal text-faint">not a member</span>
                    </span>
                  )}
                  {p.phone && (
                    <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 text-muted hover:text-accent">
                      <Phone className="size-3.5" /> {formatPhone(p.phone)}
                    </a>
                  )}
                  {p.email && <span className="text-xs text-muted">{p.email}</span>}
                </div>
              ))}
              {c.weddingDate && (
                <div className="rounded-lg bg-accent-soft px-3 py-2 text-accent">
                  <div className="text-xs">Wedding</div>
                  <div className="font-semibold">
                    {formatDate(c.weddingDate, "long")}
                    {wedding !== null && wedding >= 0 && c.status !== "completed" ? ` · in ${wedding} day${wedding === 1 ? "" : "s"}` : ""}
                  </div>
                  {c.weddingVenue && (
                    <div className="flex items-center gap-1 text-xs">
                      <MapPin className="size-3" /> {c.weddingVenue}
                    </div>
                  )}
                </div>
              )}
              {c.marriedSince && <div className="text-xs text-muted">Married since {formatDate(c.marriedSince, "long")}</div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Counsellors" action={canOversee ? <Button size="sm" variant="ghost" onClick={() => setAssigning(true)}>Change</Button> : null} />
            <CardBody className="text-[13px]">
              {c.counsellors.length ? (
                <ul className="flex flex-col gap-1">
                  {c.counsellors.map((x) => (
                    <li key={x.id}>
                      {x.name}
                      {x.id === me && <span className="text-xs text-faint"> (you)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-faint">Not assigned yet</span>
              )}
            </CardBody>
          </Card>
          {(c.kind === "premarital" || c.checklist.length > 0) && (
            <Card>
              <CardHeader title="Before the wedding" action={<span className="text-xs text-muted">{checklistDone} of {c.checklist.length} done</span>} />
              <ul className="flex flex-col gap-1.5 px-4 pb-4" data-testid="checklist">
                {c.checklist.map((x) => (
                  <li key={x.key}>
                    <Checkbox
                      label={
                        <span className={cn(isDone(x) && "text-muted line-through")}>
                          {x.label}
                          {isDone(x) && x.doneAt && <span className="ml-1 text-[11px] text-faint no-underline">{formatDate(x.doneAt, "short")}</span>}
                        </span>
                      }
                      checked={isDone(x)}
                      disabled={!open}
                      onChange={(e) => {
                        const done = e.target.checked;
                        setTicked((t) => ({ ...t, [x.key]: done }));
                        check.run({ id: c.id, key: x.key, done });
                      }}
                    />
                  </li>
                ))}
                {open && (
                  <li>
                    <button type="button" onClick={() => setAddingItem(true)} className="mt-1 flex items-center gap-1 text-xs text-accent">
                      <Plus className="size-3" /> Add a requirement
                    </button>
                  </li>
                )}
              </ul>
            </Card>
          )}
          <p className="px-1 text-xs text-faint">
            Opened {formatDate(c.createdAt)}
            {c.createdByName ? ` by ${c.createdByName}` : ""}. Every change is recorded in the audit log.
          </p>
        </div>
      </div>

      <PlanDialog target={planning} onClose={() => setPlanning(null)} c={c} team={team} nextTopic={nextTopic} me={me} />
      <RecordDialog session={recording} onClose={() => setRecording(null)} c={c} now={now} />
      <CaseDialog
        open={editing}
        onClose={() => setEditing(false)}
        team={team}
        branches={branches}
        canOversee={false}
        initial={{
          id: c.id,
          kind: c.kind,
          branchId: c.branchId,
          a: { memberId: c.a.memberId, name: c.a.name, phone: c.a.phone ?? "", email: c.a.email ?? "" },
          b: { memberId: c.b.memberId, name: c.b.name, phone: c.b.phone ?? "", email: c.b.email ?? "" },
          weddingDate: c.weddingDate,
          weddingVenue: c.weddingVenue,
          marriedSince: c.marriedSince,
          reason: c.reason,
          plannedSessions: c.plannedSessions,
          counsellorIds: c.counsellorIds,
        }}
      />
      <AssignDialog open={assigning} onClose={() => setAssigning(false)} c={c} team={team} />
      <CompleteDialog open={completing} onClose={() => setCompleting(false)} c={c} canOversee={canOversee} />
      <AddItemDialog open={addingItem} onClose={() => setAddingItem(false)} id={c.id} />
    </>
  );
}

function PlanDialog({ target, onClose, c, team, nextTopic, me }: { target: { session?: Session } | null; onClose: () => void; c: CaseDetail; team: { id: string; name: string }[]; nextTopic: string; me: string }) {
  const router = useRouter();
  const act = useAction(sessionAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const fe = act.fieldErrors;
  const s = target?.session;
  const last = c.sessions.filter((x) => x.status !== "cancelled").at(-1);
  const suggested = last ? toLocal(new Date(new Date(last.startsAt).getTime() + 7 * 86_400_000)) : "";
  const mine = c.counsellorIds.includes(me) ? me : c.counsellorIds[0];
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <DialogContent
          title={s ? "Move session" : "Plan a session"}
          description="The couple gets an email with the time and topic, and a reminder the evening before."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="plan-form" variant="primary" loading={act.pending}>
                {s ? "Move session" : "Plan session"}
              </Button>
            </>
          }
        >
          <form
            id="plan-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const g = (k: string) => String(f.get(k) ?? "");
              act.run({
                caseId: c.id,
                id: s?.id,
                topic: g("topic"),
                startsAt: g("startsAt"),
                durationMin: Number(g("durationMin") || 60),
                location: g("location") || null,
                counsellorId: g("counsellorId") || null,
                notify: f.get("notify") === "on",
              });
            }}
          >
            <Field label="Topic" htmlFor="pl-topic" error={fe.topic} className="col-span-full">
              <Input id="pl-topic" name="topic" list="pl-topics" defaultValue={s?.topic ?? nextTopic} />
              <datalist id="pl-topics">
                {c.topics.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Date and time" htmlFor="pl-start" error={fe.startsAt}>
              <Input id="pl-start" name="startsAt" type="datetime-local" defaultValue={s ? toLocal(s.startsAt) : suggested} required />
            </Field>
            <Field label="Length" htmlFor="pl-dur">
              <Select id="pl-dur" name="durationMin" defaultValue={String(s?.durationMin ?? 60)}>
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Where" htmlFor="pl-loc" optional>
              <Input id="pl-loc" name="location" defaultValue={s?.location ?? last?.location ?? ""} placeholder="e.g. Pastor's office, or Zoom" />
            </Field>
            {c.counsellorIds.length > 1 && (
              <Field label="Counsellor" htmlFor="pl-who" error={fe.counsellorId}>
                <Select id="pl-who" name="counsellorId" defaultValue={s?.counsellorId ?? mine}>
                  {c.counsellorIds.map((id) => (
                    <option key={id} value={id}>
                      {team.find((t) => t.id === id)?.name ?? "Counsellor"}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Checkbox name="notify" defaultChecked label="Email the couple" className="col-span-full" />
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function RecordDialog({ session, onClose, c, now }: { session: Session | null; onClose: () => void; c: CaseDetail; now: number }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<"held" | "missed" | "cancelled">("held");
  const act = useAction(recordAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const past = session ? new Date(session.startsAt).getTime() < now + 3600_000 : false;
  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onClose()}>
      {session && (
        <DialogContent
          title={session.topic}
          description={`${formatDate(session.startsAt, "long")}, ${formatTime(session.startsAt)}`}
          footer={
            <>
              <Button onClick={onClose}>Back</Button>
              <Button type="submit" form="rec-form" variant={outcome === "cancelled" ? "danger" : "primary"} loading={act.pending}>
                {outcome === "held" ? "Save" : outcome === "missed" ? "Mark as missed" : "Cancel session"}
              </Button>
            </>
          }
        >
          <form
            id="rec-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act.run({ caseId: c.id, id: session.id, status: outcome, attended: (String(f.get("attended") ?? "both") || "both") as "both", notes: String(f.get("notes") ?? "") || null, homework: String(f.get("homework") ?? "") || null });
            }}
          >
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What happened">
              {(
                [
                  ["held", "It held", past],
                  ["missed", "They didn't come", past],
                  ["cancelled", "Cancel it", true],
                ] as const
              ).map(([k, label, ok]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={outcome === k}
                  disabled={!ok}
                  onClick={() => setOutcome(k)}
                  className={cn("rounded-lg border px-2 py-2 text-[13px] disabled:opacity-40", outcome === k ? "border-accent bg-accent-soft font-medium" : "border-line")}
                >
                  {label}
                </button>
              ))}
            </div>
            {!past && <p className="text-xs text-faint">This session is in the future. You can cancel it now, or record it after it happens.</p>}
            {outcome === "held" && (
              <>
                <Field label="Who came" htmlFor="rec-att">
                  <Select id="rec-att" name="attended" defaultValue="both">
                    <option value="both">Both of them</option>
                    <option value="a">Only {c.a.name}</option>
                    <option value="b">Only {c.b.name}</option>
                  </Select>
                </Field>
                <Field label="Private notes" htmlFor="rec-notes" optional hint="Encrypted. Only pastors and this couple's counsellors can read them. Never sent to the couple.">
                  <Textarea id="rec-notes" name="notes" rows={5} />
                </Field>
                <Field label="Homework for the couple" htmlFor="rec-hw" optional hint="Emailed to them now.">
                  <Textarea id="rec-hw" name="homework" rows={2} placeholder="e.g. Each list three things you admire in the other." />
                </Field>
              </>
            )}
            {outcome === "missed" && (
              <Field label="Notes" htmlFor="rec-notes" optional>
                <Textarea id="rec-notes" name="notes" rows={2} placeholder="e.g. Called; travelled for work. Will reschedule." />
              </Field>
            )}
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function AssignDialog({ open, onClose, c, team }: { open: boolean; onClose: () => void; c: CaseDetail; team: { id: string; name: string }[] }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(c.counsellorIds);
  const act = useAction(assignAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Counsellors"
          description="Up to three. Many churches pair a husband-and-wife team with each couple. New counsellors get an email."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={act.pending} onClick={() => act.run({ id: c.id, counsellorIds: ids })}>
                Save
              </Button>
            </>
          }
        >
          {team.length === 0 ? (
            <p className="text-[13px] text-muted">No one has a counselling role yet. Give people the Marriage Counsellor role in Settings, Team.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {team.map((t) => (
                <Checkbox
                  key={t.id}
                  label={t.name}
                  checked={ids.includes(t.id)}
                  disabled={!ids.includes(t.id) && ids.length >= 3}
                  onChange={(e) => setIds((l) => (e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id)))}
                />
              ))}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function CompleteDialog({ open, onClose, c, canOversee }: { open: boolean; onClose: () => void; c: CaseDetail; canOversee: boolean }) {
  const router = useRouter();
  const options = (c.kind === "premarital" ? (["cleared", "not_cleared", "referred", "withdrew", "other"] as const) : (["reconciled", "referred", "withdrew", "other"] as const)).filter((o) => o !== "cleared" || canOversee);
  const [outcome, setOutcome] = useState<string>(options[0]!);
  const [override, setOverride] = useState(false);
  const act = useAction(completeAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const openItems = c.checklist.filter((x) => !x.done);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Complete counselling"
          description={c.kind === "premarital" ? "Clearing a couple issues a numbered certificate and emails them. Only pastors can clear a couple." : "Record how things ended. You can open a new record if they come back."}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="done-form" variant="primary" loading={act.pending}>
                Complete
              </Button>
            </>
          }
        >
          <form
            id="done-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              act.run({ id: c.id, outcome: outcome as "other", summary: String(new FormData(e.currentTarget).get("summary") ?? "") || null, overrideChecklist: override });
            }}
          >
            <Field label="Outcome" htmlFor="done-out">
              <Select id="done-out" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </option>
                ))}
              </Select>
            </Field>
            {outcome === "cleared" && openItems.length > 0 && (
              <Note tone="warn">
                {openItems.length} requirement{openItems.length === 1 ? " is" : "s are"} not ticked: {openItems.map((x) => x.label).join("; ")}.
                <Checkbox className="mt-2" checked={override} onChange={(e) => setOverride(e.target.checked)} label="Clear them anyway" />
              </Note>
            )}
            <Field label="Summary for the pastors" htmlFor="done-sum" optional hint="Encrypted. Not sent to the couple.">
              <Textarea id="done-sum" name="summary" rows={3} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function AddItemDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const router = useRouter();
  const act = useAction(addChecklistAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Add a requirement"
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="item-form" variant="primary" loading={act.pending}>
                Add
              </Button>
            </>
          }
        >
          <form
            id="item-form"
            onSubmit={(e) => {
              e.preventDefault();
              act.run({ id, label: String(new FormData(e.currentTarget).get("label") ?? "") });
            }}
          >
            <Field label="Requirement" htmlFor="item-label" error={act.fieldErrors.label}>
              <Input id="item-label" name="label" placeholder="e.g. Pastor's interview with both families" autoFocus />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
