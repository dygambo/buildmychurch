"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Copy, HandHeart, HeartHandshake, Lock, MoreHorizontal, Phone, Plus, QrCode, Sparkles, Trash2, UserRound } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { useAction } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import { formatDate, naira, timeAgo, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CaseRow, PrayerRow } from "@/server/services/care";
import { MemberPicker, type Picked } from "../members/member-picker";
import { addPrayerAction, deletePrayerAction, prayedAction, saveCaseAction, updatePrayerAction } from "./actions";
import { CARE_KINDS, CARE_LABEL, PRAYER_CATEGORIES, PRAYER_LABEL, PRIORITY } from "./labels";

type Summary = { openCases: number; dueCases: number; urgentCases: number; welfareMonthKobo: number; welfarePeople: number; newPrayer: number; openPrayer: number };
type Team = { id: string; name: string }[];

const PRAYER_STATUS: Record<PrayerRow["status"], { label: string; tone: Tone }> = {
  new: { label: "New", tone: "accent" },
  praying: { label: "Praying", tone: "purple" },
  answered: { label: "Answered", tone: "good" },
  closed: { label: "Closed", tone: "neutral" },
};
const SOURCE: Record<PrayerRow["source"], string> = { online: "Prayer page", visitor_card: "Visitor card", staff: "Added by staff", portal: "Member portal" };

export function CareView({
  tab,
  summary,
  team,
  link,
  prayer,
  cases,
  filters,
  pastor,
  me,
}: {
  tab: "prayer" | "cases";
  summary: Summary;
  team: Team;
  link: string;
  prayer: PrayerRow[];
  cases: CaseRow[];
  filters: Record<string, string | undefined>;
  pastor: boolean;
  me: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [opening, setOpening] = useState<{ prayer?: PrayerRow } | null>(null);
  const [sharing, setSharing] = useState(false);
  const go = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("open");
    router.replace(`${path}?${next}`, { scroll: false });
  };
  return (
    <>
      <PageHeader
        title="Prayer & care"
        description="Prayer requests from the prayer page, visitor cards and your team, and the people the pastoral team is looking after."
        actions={
          <>
            <Button onClick={() => setSharing(true)}>
              <QrCode /> Prayer page
            </Button>
            {tab === "prayer" ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> Add request
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setOpening({})}>
                <Plus /> New care record
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label="New prayer requests" value={summary.newPrayer} sub={`${summary.openPrayer} being prayed for`} />
        <Stat label="People in our care" value={summary.openCases} sub={summary.urgentCases ? `${summary.urgentCases} urgent` : "None urgent"} tone={summary.urgentCases ? "bad" : undefined} />
        <Stat label="Need a visit or call" value={summary.dueCases} sub="Due today or overdue" tone={summary.dueCases ? "bad" : undefined} />
        <Stat label="Welfare this month" value={naira(summary.welfareMonthKobo)} sub={`${summary.welfarePeople} ${summary.welfarePeople === 1 ? "person" : "people"} helped`} />
      </div>
      <LinkTabs
        className="self-start"
        current={tab}
        tabs={[
          { key: "prayer", label: "Prayer requests", href: "/care", count: summary.newPrayer || undefined },
          { key: "cases", label: "Pastoral care", href: "/care?tab=cases", count: summary.dueCases || undefined },
        ]}
      />
      {tab === "prayer" ? (
        <PrayerList list={prayer} filters={filters} go={go} team={team} me={me} onCase={(p) => setOpening({ prayer: p })} onAdd={() => setAdding(true)} />
      ) : (
        <CaseList list={cases} filters={filters} go={go} onNew={() => setOpening({})} />
      )}
      <AddPrayerDialog open={adding} onClose={() => setAdding(false)} pastor={pastor} />
      <CaseDialog key={opening ? (opening.prayer?.id ?? "new") : "none"} target={opening} onClose={() => setOpening(null)} team={team} pastor={pastor} />
      <ShareDialog open={sharing} onClose={() => setSharing(false)} link={link} />
    </>
  );
}

/* ---------------- prayer ---------------- */

function PrayerList({
  list,
  filters,
  go,
  team,
  me,
  onCase,
  onAdd,
}: {
  list: PrayerRow[];
  filters: Record<string, string | undefined>;
  go: (k: string, v: string) => void;
  team: Team;
  me: string;
  onCase: (p: PrayerRow) => void;
  onAdd: () => void;
}) {
  const highlight = filters.open;
  useEffect(() => {
    if (highlight) document.getElementById(`pr-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox placeholder="Search requests" className="w-64 max-sm:w-full" />
        <Select aria-label="Status" value={filters.status ?? ""} onChange={(e) => go("status", e.target.value)} className="w-40">
          <option value="">Open</option>
          <option value="new">New only</option>
          <option value="answered">Answered</option>
          <option value="closed">Closed</option>
          <option value="all">Everything</option>
        </Select>
        <Select aria-label="Category" value={filters.category ?? ""} onChange={(e) => go("category", e.target.value)} className="w-44">
          <option value="">All topics</option>
          {PRAYER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PRAYER_LABEL[c]}
            </option>
          ))}
        </Select>
        <Checkbox label="Given to me" checked={filters.mine === "1"} onChange={(e) => go("mine", e.target.checked ? "1" : "")} />
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<HandHeart />} title={filters.status || filters.category || filters.q ? "Nothing matches" : "No open prayer requests"} action={<Button onClick={onAdd}>Add a request</Button>}>
            Share the prayer page link or QR code in the bulletin and on screen. Requests from visitor cards land here too.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1" data-testid="prayer-list">
          {list.map((p) => (
            <PrayerCard key={p.id} p={p} team={team} me={me} onCase={() => onCase(p)} highlight={p.id === highlight} />
          ))}
        </div>
      )}
    </>
  );
}

function PrayerCard({ p, team, me, onCase, highlight }: { p: PrayerRow; team: Team; me: string; onCase: () => void; highlight: boolean }) {
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };
  const prayed = useAction(prayedAction, refresh);
  const update = useAction(updatePrayerAction, refresh);
  const del = useAction(deletePrayerAction, refresh);
  const [answering, setAnswering] = useState(false);
  const st = PRAYER_STATUS[p.status];
  return (
    <article id={`pr-${p.id}`} className={cn("flex flex-col gap-2.5 rounded-xl border bg-surface p-4", highlight ? "border-accent ring-2 ring-accent/20" : "border-line")} aria-label={`Prayer request from ${p.name ?? "someone anonymous"}`}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
            {p.memberId ? (
              <Link href={`/members/${p.memberId}`} className="hover:text-accent">
                {p.name}
              </Link>
            ) : (
              <span>{p.name ?? "Anonymous"}</span>
            )}
            {p.confidential && (
              <Badge tone="warn">
                <Lock className="size-3" /> Pastors only
              </Badge>
            )}
          </div>
          <div className="text-xs text-faint">
            {PRAYER_LABEL[p.category]} · {SOURCE[p.source]} · {timeAgo(p.createdAt)}
          </div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownItem onSelect={onCase}>
              <HeartHandshake /> Open a care record
            </DropdownItem>
            {p.status !== "closed" && <DropdownItem onSelect={() => update.run({ id: p.id, status: "closed" })}>Close without an answer</DropdownItem>}
            {(p.status === "answered" || p.status === "closed") && <DropdownItem onSelect={() => update.run({ id: p.id, status: "praying" })}>Reopen</DropdownItem>}
            <DropdownSeparator />
            <DropdownItem danger onSelect={() => del.run({ id: p.id })}>
              <Trash2 /> Remove
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </header>
      <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{p.body}</p>
      {(p.phone || p.email) && (
        <div className="flex flex-wrap gap-x-3 text-xs text-muted">
          {p.phone && (
            <a href={`tel:${p.phone}`} className="flex items-center gap-1 hover:text-accent">
              <Phone className="size-3" /> {p.phone}
            </a>
          )}
          {p.email && <span>{p.email}</span>}
          {p.wantsContact && <span className="font-medium text-warn">Wants someone to reach out</span>}
        </div>
      )}
      {p.testimony && (
        <div className="rounded-lg bg-good-soft px-3 py-2 text-[13px] text-good">
          <span className="font-semibold">Testimony: </span>
          {p.testimony}
        </div>
      )}
      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <Button size="sm" variant={p.lastPrayedAt ? "ghost" : "primary"} loading={prayed.pending} onClick={() => prayed.run({ id: p.id })}>
          <Sparkles /> I prayed
        </Button>
        <span className="text-xs text-faint">{p.prayedCount ? `Prayed ${p.prayedCount}×, last ${timeAgo(p.lastPrayedAt!)}` : "Not prayed for yet"}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <UserRound className="size-3.5 text-faint" />
          <select
            aria-label={`Who follows up the request from ${p.name ?? "someone"}`}
            value={p.assignedTo ?? ""}
            onChange={(e) => update.run({ id: p.id, assignedTo: e.target.value || null })}
            className="max-w-36 truncate bg-transparent text-xs text-muted outline-none"
          >
            <option value="">No one yet</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id === me ? "Me" : t.name}
              </option>
            ))}
          </select>
          {p.status !== "answered" && (
            <Button size="sm" variant="ghost" onClick={() => setAnswering(true)}>
              <CheckCircle2 /> Answered
            </Button>
          )}
        </span>
      </footer>
      <Dialog open={answering} onOpenChange={setAnswering}>
        <DialogContent
          title="Mark as answered"
          description="Record the testimony if they shared one. It encourages the prayer team."
          footer={
            <>
              <Button onClick={() => setAnswering(false)}>Cancel</Button>
              <Button type="submit" form={`ans-${p.id}`} variant="primary" loading={update.pending}>
                Mark answered
              </Button>
            </>
          }
        >
          <form
            id={`ans-${p.id}`}
            onSubmit={(e) => {
              e.preventDefault();
              const t = String(new FormData(e.currentTarget).get("testimony") ?? "");
              update.run({ id: p.id, status: "answered", testimony: t || null }).then((r) => r?.ok && setAnswering(false));
            }}
          >
            <Field label="Testimony" htmlFor={`t-${p.id}`} optional>
              <Textarea id={`t-${p.id}`} name="testimony" rows={3} placeholder="e.g. She got the job at the bank on Monday." />
            </Field>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function AddPrayerDialog({ open, onClose, pastor }: { open: boolean; onClose: () => void; pastor: boolean }) {
  const router = useRouter();
  const [member, setMember] = useState<Picked | null>(null);
  const act = useAction(addPrayerAction, {
    onSuccess: () => {
      onClose();
      setMember(null);
      router.refresh();
    },
  });
  const fe = act.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Add a prayer request"
        description="For requests given to you after service, by phone or on paper."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form="add-prayer" variant="primary" loading={act.pending}>
              Add request
            </Button>
          </>
        }
      >
        <form
          id="add-prayer"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act.run({
              memberId: member?.id ?? null,
              name: member ? null : String(f.get("name") ?? ""),
              phone: String(f.get("phone") ?? ""),
              email: "",
              body: String(f.get("body") ?? ""),
              category: String(f.get("category")) as PrayerRow["category"],
              confidential: f.get("confidential") === "on",
              wantsContact: f.get("wantsContact") === "on",
              branchId: null,
            });
          }}
        >
          {member ? (
            <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px]">
              <span>
                <span className="font-medium">{member.name}</span> <span className="text-faint">{member.memberNo}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setMember(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <MemberPicker onPick={setMember} placeholder="Find a member (or type a name below)" />
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="Name" htmlFor="ap-name" error={fe.name} hint="If they're not a member yet">
                  <Input id="ap-name" name="name" />
                </Field>
                <Field label="Phone" htmlFor="ap-phone" error={fe.phone} optional>
                  <Input id="ap-phone" name="phone" inputMode="tel" />
                </Field>
              </div>
            </>
          )}
          <Field label="Prayer request" htmlFor="ap-body" error={fe.body}>
            <Textarea id="ap-body" name="body" rows={4} />
          </Field>
          <Field label="Topic" htmlFor="ap-cat">
            <Select id="ap-cat" name="category" defaultValue="other">
              {PRAYER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PRAYER_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox name="wantsContact" label="They'd like someone to reach out" />
          {pastor && <Checkbox name="confidential" label="Confidential: pastors only" />}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ open, onClose, link }: { open: boolean; onClose: () => void; link: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="The prayer page" description="Anyone can send a prayer request here, with or without their name. Put the QR code in the bulletin or on screen.">
        <div className="flex flex-col items-center gap-3">
          <QrImage value={link} size={180} label="QR code for the prayer page" />
          <code className="max-w-full truncate rounded bg-surface-2 px-2 py-1 font-mono text-xs" data-testid="prayer-link">
            {link}
          </code>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                navigator.clipboard.writeText(link).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy the link"),
                )
              }
            >
              <Copy /> Copy link
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={link} target="_blank" rel="noopener">
                Open
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- care cases ---------------- */

function CaseList({ list, filters, go, onNew }: { list: CaseRow[]; filters: Record<string, string | undefined>; go: (k: string, v: string) => void; onNew: () => void }) {
  const today = todayISO();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" value={filters.status ?? ""} onChange={(e) => go("status", e.target.value)} className="w-36">
          <option value="">Open</option>
          <option value="closed">Closed</option>
          <option value="all">Everything</option>
        </Select>
        <Select aria-label="Kind" value={filters.kind ?? ""} onChange={(e) => go("kind", e.target.value)} className="w-44">
          <option value="">All kinds</option>
          {CARE_KINDS.map((k) => (
            <option key={k} value={k}>
              {CARE_LABEL[k]}
            </option>
          ))}
        </Select>
        <Checkbox label="Given to me" checked={filters.mine === "1"} onChange={(e) => go("mine", e.target.checked ? "1" : "")} />
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState icon={<HeartHandshake />} title="No one on the care list" action={<Button onClick={onNew}>Open a care record</Button>}>
            Track hospital visits, bereavements, new babies, counselling and welfare support, so no one falls through the cracks.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="max-md:hidden">Looking after</Th>
                <Th>Next step</Th>
                <Th className="max-sm:hidden" num>
                  Welfare
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const pr = PRIORITY[c.priority];
                const late = c.nextActionOn && c.nextActionOn <= today && c.status === "open";
                return (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/care/cases/${c.id}`} className="font-medium hover:text-accent">
                        {c.memberName}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{CARE_LABEL[c.kind]}</span>
                        {c.priority !== "normal" && <Badge tone={pr.tone}>{pr.label}</Badge>}
                        {c.confidential && <Lock className="size-3 text-warn" aria-label="Pastors only" />}
                        {c.status === "closed" && <Badge>Closed</Badge>}
                      </div>
                    </Td>
                    <Td className="text-[13px] max-md:hidden">
                      {c.assignedName ?? <span className="text-faint">No one yet</span>}
                      <div className="text-xs text-faint">{c.lastEntry ? `Last contact ${formatDate(c.lastEntry, "short")}` : "No contact recorded"}</div>
                    </Td>
                    <Td className="text-[13px]">
                      {c.nextAction || c.nextActionOn ? (
                        <>
                          <div className={cn(late && "font-medium text-bad")}>{c.nextAction ?? "Follow up"}</div>
                          {c.nextActionOn && <div className={cn("text-xs", late ? "text-bad" : "text-faint")}>{c.nextActionOn < today ? `Overdue since ${formatDate(c.nextActionOn, "short")}` : c.nextActionOn === today ? "Today" : formatDate(c.nextActionOn, "week")}</div>}
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                    <Td num className="max-sm:hidden">
                      {c.welfareKobo ? naira(c.welfareKobo) : <span className="text-faint">—</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export function CaseDialog({
  target,
  onClose,
  team,
  pastor,
  initial,
}: {
  target: { prayer?: PrayerRow } | null;
  onClose: () => void;
  team: Team;
  pastor: boolean;
  initial?: { id: string; memberId: string; memberName: string; kind: string; title: string; summary: string | null; priority: string; confidential: boolean; assignedTo: string | null; nextActionOn: string | null; nextAction: string | null };
}) {
  const router = useRouter();
  const [member, setMember] = useState<{ id: string; name: string } | null>(
    initial ? { id: initial.memberId, name: initial.memberName } : target?.prayer?.memberId ? { id: target.prayer.memberId, name: target.prayer.name ?? "Member" } : null,
  );
  const [kind, setKind] = useState(initial?.kind ?? "visitation");
  const act = useAction(saveCaseAction, {
    onSuccess: (d) => {
      onClose();
      if (!initial) router.push(`/care/cases/${d.id}`);
      else router.refresh();
    },
  });
  const fe = act.fieldErrors;
  const p = target?.prayer;
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <DialogContent
          title={initial ? "Edit care record" : "New care record"}
          description={p ? `From ${p.name ?? "an anonymous"}'s prayer request.` : "Someone the pastoral team should look after."}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="case-form" variant="primary" loading={act.pending}>
                {initial ? "Save" : "Open record"}
              </Button>
            </>
          }
        >
          <form
            id="case-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const g = (k: string) => String(f.get(k) ?? "");
              act.run({
                id: initial?.id,
                memberId: member?.id ?? "",
                kind: kind as CaseRow["kind"],
                title: g("title"),
                summary: g("summary"),
                priority: g("priority") as CaseRow["priority"],
                confidential: f.get("confidential") === "on",
                assignedTo: g("assignedTo") || null,
                nextActionOn: g("nextActionOn") || null,
                nextAction: g("nextAction") || null,
                prayerRequestId: p?.id ?? null,
              });
            }}
          >
            <div className="col-span-full">
              {member ? (
                <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px]">
                  <span className="font-medium">{member.name}</span>
                  {!initial && (
                    <Button size="sm" variant="ghost" onClick={() => setMember(null)}>
                      Change
                    </Button>
                  )}
                </div>
              ) : (
                <Field label="Member" htmlFor="cs-member" error={fe.memberId}>
                  <MemberPicker onPick={(m) => setMember({ id: m.id, name: m.name })} placeholder="Find the member" />
                </Field>
              )}
            </div>
            <Field label="What's happening" htmlFor="cs-kind">
              <Select id="cs-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {CARE_KINDS.filter((k) => pastor || k !== "counselling").map((k) => (
                  <option key={k} value={k}>
                    {CARE_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="cs-pri">
              <Select id="cs-pri" name="priority" defaultValue={initial?.priority ?? (kind === "bereavement" ? "high" : "normal")}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Short description" htmlFor="cs-title" error={fe.title} className="col-span-full">
              <Input id="cs-title" name="title" defaultValue={initial?.title ?? (p ? p.body.slice(0, 120) : "")} placeholder="e.g. Admitted at LUTH after a car accident" />
            </Field>
            <Field label="Details" htmlFor="cs-sum" optional className="col-span-full">
              <Textarea id="cs-sum" name="summary" rows={3} defaultValue={initial?.summary ?? ""} placeholder="Ward, family contacts, what they need" />
            </Field>
            <Field label="Who will look after them" htmlFor="cs-who" error={fe.assignedTo}>
              <Select id="cs-who" name="assignedTo" defaultValue={initial?.assignedTo ?? ""}>
                <option value="">Decide later</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Next step by" htmlFor="cs-on" optional error={fe.nextActionOn}>
              <Input id="cs-on" name="nextActionOn" type="date" defaultValue={initial?.nextActionOn ?? todayISO()} />
            </Field>
            <Field label="Next step" htmlFor="cs-next" optional className="col-span-full">
              <Input id="cs-next" name="nextAction" defaultValue={initial?.nextAction ?? ""} placeholder="e.g. Visit with the welfare team" />
            </Field>
            {pastor && kind !== "counselling" && <Checkbox name="confidential" defaultChecked={initial?.confidential} label="Confidential: pastors only" className="col-span-full" />}
            {kind === "counselling" && <p className="col-span-full text-xs text-faint">Counselling records are always confidential.</p>}
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
