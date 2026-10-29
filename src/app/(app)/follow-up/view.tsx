"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlarmClock,
  Copy,
  HandHeart,
  Home,
  MessageCircle,
  Phone,
  Printer,
  QrCode,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { useAction, formToObject } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import { formatDate, timeAgo } from "@/lib/format";
import { localPhone } from "@/lib/phone";
import {
  addNoteAction,
  assignFollowupAction,
  loadFollowupAction,
  moveFollowupAction,
  rotateVisitorLinkAction,
} from "./actions";

type Item = {
  id: string;
  stage: string;
  reason: string;
  wantsVisit: boolean;
  dueAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  assignedTo: string | null;
  assigneeName: string | null;
  memberId: string;
  title: string | null;
  firstName: string;
  lastName: string;
  area: string | null;
  phone: string | null;
  hasPrayer: boolean;
  notes: number;
  overdue: boolean;
};

const COLUMNS = [
  { key: "new", title: "New", hint: "Not contacted yet" },
  { key: "contacted", title: "Contacted", hint: "Spoken to at least once" },
  { key: "visited", title: "Visited", hint: "Met in person or at home" },
  { key: "integrated", title: "Integrated", hint: "Settled in: in a cell or department" },
] as const;
const REASON: Record<string, { label: string; tone: Tone }> = {
  first_timer: { label: "First timer", tone: "warn" },
  absentee: { label: "Absent 3 weeks", tone: "bad" },
  new_convert: { label: "New convert", tone: "good" },
  other: { label: "Other", tone: "neutral" },
};
const METHOD: Record<string, string> = {
  call: "Phone call",
  sms: "SMS",
  whatsapp: "WhatsApp",
  visit: "Home visit",
  email: "Email",
  in_person: "In church",
  note: "Note",
};
const OUTCOME: Record<string, string> = {
  reached: "Spoke with them",
  no_answer: "No answer",
  wrong_number: "Wrong number",
  callback: "Asked to call back",
  done: "Done",
};

export function FollowupBoard({
  who,
  me,
  showCard,
  openId,
  visitorUrl,
  team,
  items,
}: {
  who: string;
  me: string;
  showCard: boolean;
  openId: string | null;
  visitorUrl: string;
  team: { id: string; name: string }[];
  items: Item[];
}) {
  const [card, setCard] = useState(showCard);
  const [openCase, setOpenCase] = useState<string | null>(openId);
  const rotate = useAction(rotateVisitorLinkAction);
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const mine = items.filter((i) => i.assignedTo === me && i.overdue).length;
  return (
    <>
      <PageHeader
        title="Follow-up"
        description="First timers and people who've been away. Every contact is logged, so nobody falls through the cracks."
        actions={
          <Button variant={card ? "secondary" : "primary"} onClick={() => setCard((c) => !c)}>
            <QrCode /> Visitor card
          </Button>
        }
      />
      {card && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-6">
            <div className="print-area flex flex-col items-center gap-2 bg-white p-4 text-center text-[#0e1a33]">
              <div className="text-base font-bold">First time here? Welcome!</div>
              <QrImage value={visitorUrl} size={200} label="Visitor card QR code" />
              <div className="text-sm">Scan to fill our visitor card</div>
            </div>
            <div className="flex max-w-md flex-col gap-3 text-[13px] text-muted">
              <p>
                Show this on screen during announcements, or print it for the welcome desk and seat backs. Visitors fill
                a short form on their phone. They&apos;re added as first timers and shared out to your follow-up team
                automatically.
              </p>
              <code className="rounded-lg bg-surface-2 px-2 py-1 text-xs break-all text-fg">{visitorUrl}</code>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(visitorUrl);
                    toast.success("Link copied");
                  }}
                >
                  <Copy /> Copy link
                </Button>
                <Button onClick={() => window.print()}>
                  <Printer /> Print
                </Button>
                <Button variant="ghost" loading={rotate.pending} onClick={() => rotate.run({})}>
                  <RefreshCw /> New code
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <LinkTabs
          current={who}
          tabs={[
            { key: "all", label: "Everyone's", href: path },
            { key: "me", label: "Mine", href: `${path}?who=me` },
            { key: "none", label: "Unassigned", href: `${path}?who=none` },
          ]}
        />
        {mine > 0 && (
          <Badge tone="bad" className="ml-auto">
            <AlarmClock className="size-3" /> {mine} of yours overdue
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        {COLUMNS.map((col) => {
          const list = items.filter((i) => i.stage === col.key);
          return (
            <section
              key={col.key}
              aria-label={col.title}
              className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2 p-2.5"
            >
              <header className="flex items-baseline gap-2 px-1">
                <h3 className="font-semibold">{col.title}</h3>
                <span className="text-xs text-faint">{list.length}</span>
                <span className="ml-auto truncate text-[11px] text-faint">{col.hint}</span>
              </header>
              {list.map((i) => (
                <button
                  key={i.id}
                  onClick={() => setOpenCase(i.id)}
                  className={`flex flex-col gap-2 rounded-xl border bg-surface p-3 text-left shadow-card hover:border-accent-line ${i.overdue ? "border-bad/40" : "border-line"}`}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={`${i.firstName} ${i.lastName}`} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {i.firstName} {i.lastName}
                    </span>
                    {i.assigneeName && (
                      <span title={`Assigned to ${i.assigneeName}`}>
                        <Avatar name={i.assigneeName} size="sm" className="size-5 text-[9px]" />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={REASON[i.reason]!.tone}>{REASON[i.reason]!.label}</Badge>
                    {i.wantsVisit && (
                      <Badge tone="purple">
                        <Home className="size-3" /> Wants a visit
                      </Badge>
                    )}
                    {i.hasPrayer && (
                      <Badge tone="teal">
                        <HandHeart className="size-3" /> Prayer
                      </Badge>
                    )}
                  </div>
                  <div className={`text-xs ${i.overdue ? "font-medium text-bad" : "text-faint"}`}>
                    {i.overdue
                      ? `Overdue since ${formatDate(i.dueAt!)}`
                      : i.lastContactAt
                        ? `Last contact ${timeAgo(i.lastContactAt)}`
                        : `Added ${timeAgo(i.createdAt)}`}
                    {i.area && ` · ${i.area}`}
                  </div>
                </button>
              ))}
              {list.length === 0 && <p className="px-1 py-3 text-center text-xs text-faint">Nobody here</p>}
            </section>
          );
        })}
      </div>
      <CaseDrawer
        id={openCase}
        team={team}
        onClose={() => {
          setOpenCase(null);
          if (sp.get("open")) router.replace(path, { scroll: false });
        }}
      />
    </>
  );
}

type Case = Extract<Awaited<ReturnType<typeof loadFollowupAction>>, { ok: true }>["data"];

function CaseDrawer({
  id,
  team,
  onClose,
}: {
  id: string | null;
  team: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [data, setData] = useState<Case | null>(null);
  const [closing, setClosing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const load = useAction(loadFollowupAction, { onSuccess: setData });
  const note = useAction(addNoteAction, {
    onSuccess: () => {
      formRef.current?.reset();
      if (id) void load.run({ id });
    },
  });
  const move = useAction(moveFollowupAction, {
    onSuccess: () => {
      setClosing(false);
      if (id) void load.run({ id });
    },
  });
  const assign = useAction(assignFollowupAction);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (id !== loaded) {
    setLoaded(id);
    setData(null);
    setClosing(false);
  }
  const loadRef = useRef(load.run);
  useEffect(() => {
    loadRef.current = load.run;
  });
  useEffect(() => {
    if (id) void loadRef.current({ id });
  }, [id]);

  const m = data?.member;
  const wa = m?.phone ? `https://wa.me/${m.phone.replace("+", "")}` : null;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      {id && (
        <DialogContent
          side
          title={m ? `${m.firstName} ${m.lastName}` : "Loading…"}
          description={m ? `${REASON[data!.reason]!.label} · ${m.memberNo}` : undefined}
        >
          {!data ? (
            <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {m!.phone && (
                  <>
                    <Button asChild>
                      <a href={`tel:${m!.phone}`}>
                        <Phone /> {localPhone(m!.phone)}
                      </a>
                    </Button>
                    <Button asChild>
                      <a href={wa!} target="_blank" rel="noreferrer">
                        <MessageCircle /> WhatsApp
                      </a>
                    </Button>
                  </>
                )}
                <Button variant="ghost" asChild>
                  <Link href={`/members/${m!.id}`}>
                    <UserRound /> Profile
                  </Link>
                </Button>
              </div>
              {data.prayerRequest && (
                <Note tone="accent" icon={<HandHeart />}>
                  <b>Prayer request:</b> {data.prayerRequest}
                </Note>
              )}
              {data.wantsVisit && (
                <Note tone="warn" icon={<Home />}>
                  They would like a visit{m!.area ? ` (${m!.area})` : ""}.
                </Note>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stage" htmlFor="fu-stage">
                  <Select
                    id="fu-stage"
                    value={closing ? "closed" : data.stage}
                    onChange={(e) => {
                      if (e.target.value === "closed") setClosing(true);
                      else move.run({ id: data.id, stage: e.target.value as "new" });
                    }}
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.title}
                      </option>
                    ))}
                    <option value="closed">Closed</option>
                  </Select>
                </Field>
                <Field label="Assigned to" htmlFor="fu-assign">
                  <Select
                    id="fu-assign"
                    defaultValue={data.assignedTo ?? ""}
                    onChange={(e) => assign.run({ id: data.id, userId: e.target.value })}
                  >
                    <option value="">No one</option>
                    {team.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {closing && (
                <form
                  className="flex flex-col gap-2 rounded-xl border border-line p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    move.run({
                      id: data.id,
                      stage: "closed",
                      closedReason: String(new FormData(e.currentTarget).get("reason") ?? ""),
                    });
                  }}
                >
                  <Field label="Why close this?" htmlFor="fu-reason" error={move.fieldErrors.closedReason}>
                    <Input
                      id="fu-reason"
                      name="reason"
                      required
                      placeholder="e.g. Was visiting from Abuja; attends another church"
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setClosing(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="danger" loading={move.pending}>
                      Close follow-up
                    </Button>
                  </div>
                </form>
              )}

              <form
                ref={formRef}
                className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  note.run({ id: data.id, ...(formToObject(e.currentTarget) as Record<string, string>) } as never);
                }}
              >
                <div className="text-[13px] font-semibold">Log a contact</div>
                <div className="grid grid-cols-2 gap-2">
                  <Select name="method" aria-label="How" defaultValue="call">
                    {Object.entries(METHOD).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  <Select name="outcome" aria-label="Outcome" defaultValue="reached">
                    <option value="">No outcome</option>
                    {Object.entries(OUTCOME).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
                <Textarea
                  name="body"
                  rows={2}
                  aria-label="Notes"
                  placeholder="What happened? Anything the next person should know?"
                />
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    Next contact in
                    <Select name="nextDueDays" aria-label="Next contact in" className="h-8 w-auto" defaultValue="7">
                      <option value="0">No reminder</option>
                      <option value="2">2 days</option>
                      <option value="7">1 week</option>
                      <option value="14">2 weeks</option>
                      <option value="30">1 month</option>
                    </Select>
                  </label>
                  <Button type="submit" variant="primary" className="ml-auto" loading={note.pending}>
                    Save
                  </Button>
                </div>
              </form>

              <ol className="flex flex-col gap-3">
                {data.notes.map((n) => (
                  <li key={n.id} className="flex gap-3 text-[13px]">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                    <div className="min-w-0">
                      <div className="font-medium">
                        {METHOD[n.method]}
                        {n.outcome && <span className="font-normal text-muted"> · {OUTCOME[n.outcome]}</span>}
                      </div>
                      {n.body && <p className="mt-0.5 whitespace-pre-wrap text-muted">{n.body}</p>}
                      <div className="text-xs text-faint">
                        {n.authorName} · {timeAgo(n.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
                <li className="flex gap-3 text-[13px]">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-line-strong" />
                  <div className="text-faint">Follow-up opened {timeAgo(data.createdAt)}</div>
                </li>
              </ol>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
