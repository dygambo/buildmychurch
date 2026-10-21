"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, FlaskConical, Mail, MessageCircle, MessageSquareText, Send, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { naira } from "@/lib/format";
import { MAX_SMS_PAGES, smsInfo } from "@/lib/sms";
import { cn } from "@/lib/utils";
import { MemberPicker } from "../../members/member-picker";
import { previewAction, sendCampaignAction, sendTestAction } from "../actions";
import { SKIP, STAGES } from "../labels";

type Opt = { id: string; name: string };
type Kind = "everyone" | "stages" | "groups" | "tags" | "people";
type Stage = "visitor" | "first_timer" | "second_timer" | "regular" | "member";
type Preview = { total: number; reachable: number; skipped: Record<string, number>; sample: string[]; unitsEstimate: number; balance: number | null };

const TOKENS = [
  ["{first_name}", "First name"],
  ["{full_name}", "Full name"],
  ["{church}", "Church name"],
] as const;

const KIND_LABEL: Record<Kind, string> = {
  everyone: "Everyone",
  stages: "By stage",
  groups: "Departments & cells",
  tags: "By tag",
  people: "Choose people",
};

/** "2026-10-18T08:00" typed in Lagos → ISO. Lagos is UTC+1 all year. */
const lagosToIso = (local: string) => new Date(`${local}:00+01:00`).toISOString();

export function Composer({
  channel,
  church,
  whatsapp,
  balance,
  unitPriceKobo,
  canBuy,
  hasPhone,
  branches,
  groups,
  tags,
  templates,
  initialTemplate,
  initialPeople,
}: {
  channel: "sms" | "email" | "whatsapp";
  church: string;
  whatsapp: boolean;
  balance: number;
  unitPriceKobo: number;
  canBuy: boolean;
  hasPhone: boolean;
  branches: Opt[];
  groups: (Opt & { kind: string })[];
  tags: Opt[];
  templates: (Opt & { subject: string | null; body: string })[];
  initialTemplate?: string;
  initialPeople: Opt[];
}) {
  const router = useRouter();
  const tpl = templates.find((t) => t.id === initialTemplate);
  const [kind, setKind] = useState<Kind>(initialPeople.length ? "people" : "everyone");
  const [stages, setStages] = useState<Stage[]>(["member", "regular"]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [people, setPeople] = useState<Opt[]>(initialPeople);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [gender, setGender] = useState("");
  const [subject, setSubject] = useState(tpl?.subject ?? "");
  const [body, setBody] = useState(tpl?.body ?? "");
  const [schedule, setSchedule] = useState(false);
  const [when, setWhen] = useState("");
  const [rawPreview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const audience = useMemo(
    () => ({
      kind,
      stages: kind === "stages" ? stages : undefined,
      groupIds: kind === "groups" ? groupIds : undefined,
      tagIds: kind === "tags" ? tagIds : undefined,
      memberIds: kind === "people" ? people.map((p) => p.id) : undefined,
      branchIds: branchIds.length ? branchIds : undefined,
      gender: (gender || undefined) as "male" | "female" | undefined,
    }),
    [kind, stages, groupIds, tagIds, people, branchIds, gender],
  );
  const audienceReady = kind === "everyone" || (audience.stages ?? audience.groupIds ?? audience.tagIds ?? audience.memberIds ?? []).length > 0;

  const prev = useAction(previewAction);
  const runPreview = prev.run;
  useEffect(() => {
    if (!audienceReady) return;
    const t = setTimeout(async () => {
      const r = await runPreview({ audience, channel, body });
      if (r?.ok) setPreview(r.data);
    }, 350);
    return () => clearTimeout(t);
    // body only changes the unit estimate; re-run when it does, but not on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, channel, audienceReady, channel === "sms" ? smsInfo(body).pages : 0, runPreview]);

  const preview = audienceReady ? rawPreview : null;
  const sample = (body || (channel === "email" ? "Your message" : "Your message appears here"))
    .replace(/\{first_name\}/gi, "Ngozi")
    .replace(/\{last_name\}/gi, "Okafor")
    .replace(/\{full_name\}/gi, "Sis. Ngozi Okafor")
    .replace(/\{title\}/gi, "Sis.")
    .replace(/\{church\}/gi, church);
  const info = smsInfo(sample);
  const tooLong = channel === "sms" && info.pages > MAX_SMS_PAGES;
  const units = preview?.unitsEstimate ?? 0;
  const short = channel === "sms" && units > balance;

  const send = useAction(sendCampaignAction, { onSuccess: (d) => router.push(`/messages/${d.id}`) });
  const test = useAction(sendTestAction, { onSuccess: () => setTesting(false) });

  const insert = (token: string) => {
    const el = textarea.current;
    if (!el) return setBody((b) => b + token);
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const Icon = channel === "email" ? Mail : channel === "whatsapp" ? MessageCircle : MessageSquareText;
  const title = channel === "email" ? "New email" : channel === "whatsapp" ? "New WhatsApp message" : "New SMS";
  const canSend = audienceReady && !!body.trim() && !tooLong && !short && (channel !== "email" || !!subject.trim()) && (preview?.reachable ?? 0) > 0 && (!schedule || !!when);

  return (
    <>
      <PageHeader
        title={title}
        description={
          channel === "whatsapp"
            ? "Goes out through your church's approved WhatsApp template. People need to have agreed to messages."
            : "Goes to people who agreed to receive messages. Personalise it with their name."
        }
        actions={
          <div className="flex gap-1 rounded-[10px] border border-line bg-surface-2 p-[3px]">
            {(["sms", "email", ...(whatsapp ? ["whatsapp"] : [])] as const).map((c) => (
              <Link
                key={c}
                href={`/messages/new?channel=${c}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium",
                  c === channel ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                )}
              >
                {c === "sms" ? "SMS" : c === "email" ? "Email" : "WhatsApp"}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Who gets it" />
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Audience">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      "h-8 rounded-full border px-3 text-[13px] font-medium",
                      kind === k ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-muted hover:text-fg",
                    )}
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              {kind === "stages" && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {Object.entries(STAGES).map(([k, l]) => (
                    <Checkbox
                      key={k}
                      label={l}
                      checked={stages.includes(k as Stage)}
                      onChange={() => setStages((x) => (x.includes(k as Stage) ? x.filter((y) => y !== k) : [...x, k as Stage]))}
                    />
                  ))}
                </div>
              )}
              {kind === "groups" && (
                <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto max-sm:grid-cols-1">
                  {groups.length === 0 && <p className="text-[13px] text-muted">No departments or cells yet.</p>}
                  {groups.map((g) => (
                    <Checkbox key={g.id} label={g.name} checked={groupIds.includes(g.id)} onChange={() => toggle(groupIds, setGroupIds, g.id)} />
                  ))}
                </div>
              )}
              {kind === "tags" && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {tags.length === 0 && <p className="text-[13px] text-muted">No tags yet. Add tags on member profiles.</p>}
                  {tags.map((t) => (
                    <Checkbox key={t.id} label={t.name} checked={tagIds.includes(t.id)} onChange={() => toggle(tagIds, setTagIds, t.id)} />
                  ))}
                </div>
              )}
              {kind === "people" && (
                <div className="flex flex-col gap-2">
                  <MemberPicker
                    exclude={people.map((p) => p.id)}
                    onPick={(m) => setPeople((p) => [...p, { id: m.id, name: m.name }])}
                    placeholder="Add someone by name or phone"
                  />
                  {people.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {people.map((p) => (
                        <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-2.5 text-[13px]">
                          {p.name}
                          <button
                            type="button"
                            aria-label={`Remove ${p.name}`}
                            className="rounded-full p-0.5 text-faint hover:bg-surface-3 hover:text-fg"
                            onClick={() => setPeople((x) => x.filter((y) => y.id !== p.id))}
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {kind !== "people" && (
                <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 max-sm:grid-cols-1">
                  {branches.length > 1 && (
                    <Field label="Branch" htmlFor="m-branch">
                      <Select id="m-branch" value={branchIds[0] ?? ""} onChange={(e) => setBranchIds(e.target.value ? [e.target.value] : [])}>
                        <option value="">All branches</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label="Only" htmlFor="m-gender">
                    <Select id="m-gender" value={gender} onChange={(e) => setGender(e.target.value)}>
                      <option value="">Men and women</option>
                      <option value="male">Men</option>
                      <option value="female">Women</option>
                    </Select>
                  </Field>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Message"
              action={
                templates.length > 0 && (
                  <Select
                    aria-label="Start from a template"
                    className="h-8 w-48 text-[13px]"
                    value=""
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value);
                      if (t) {
                        setBody(t.body);
                        if (t.subject) setSubject(t.subject);
                      }
                    }}
                  >
                    <option value="">Use a template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                )
              }
            />
            <CardBody className="flex flex-col gap-3">
              {channel === "email" && (
                <Field label="Subject" htmlFor="m-subject" error={send.fieldErrors.subject}>
                  <Input id="m-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. This Sunday at {church}" />
                </Field>
              )}
              <Field label="Message" htmlFor="m-body" error={send.fieldErrors.body}>
                <Textarea
                  id="m-body"
                  ref={textarea}
                  rows={channel === "email" ? 10 : 5}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    channel === "email"
                      ? "Dear {first_name},\n\nWrite your message. Leave a blank line between paragraphs."
                      : "Hi {first_name}, join us this Sunday at 8am…"
                  }
                />
              </Field>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-faint">Insert:</span>
                {TOKENS.map(([t, l]) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => insert(t)}
                    className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs text-muted hover:text-fg"
                  >
                    {l}
                  </button>
                ))}
                {channel === "sms" && (
                  <span className={cn("ml-auto tabular text-xs", tooLong ? "text-bad" : "text-muted")} data-testid="sms-counter">
                    {info.length} characters · {info.pages} page{info.pages === 1 ? "" : "s"}
                    {info.encoding === "Unicode" && " · emoji or special letters make pages shorter"}
                  </span>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-3">
              <Checkbox label="Send it later" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} />
              {schedule && (
                <Field label="Send on (Lagos time)" htmlFor="m-when" error={send.fieldErrors.scheduleAt} className="max-w-xs">
                  <Input id="m-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="sticky top-4 flex flex-col gap-4 max-lg:static">
          <Card>
            <CardHeader title="Preview" action={<Icon className="size-4 text-faint" />} />
            <CardBody>
              {channel === "email" ? (
                <div className="rounded-lg border border-line text-[13px]">
                  <div className="border-b border-line px-3 py-2">
                    <div className="font-semibold">{(subject || "Subject").replace(/\{first_name\}/gi, "Ngozi").replace(/\{church\}/gi, church)}</div>
                    <div className="text-xs text-faint">From {church}</div>
                  </div>
                  <div className="max-h-72 overflow-y-auto px-3 py-2 whitespace-pre-wrap">{sample}</div>
                </div>
              ) : (
                <div className="mx-auto max-w-[280px] rounded-[22px] border border-line bg-surface-2 p-3">
                  <div className="mb-2 text-center text-[11px] text-faint">{channel === "whatsapp" ? church : "SMS"}</div>
                  <div
                    className={cn(
                      "rounded-2xl rounded-tl-sm px-3 py-2 text-[13px] whitespace-pre-wrap shadow-sm",
                      channel === "whatsapp" ? "bg-[#dcf8c6] text-[#111]" : "bg-surface",
                    )}
                    data-testid="message-preview"
                  >
                    {channel === "sms" ? info.text : sample}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-3 text-[13px]">
              {!audienceReady ? (
                <p className="text-muted">Choose who should get this message.</p>
              ) : !preview ? (
                <p className="text-muted">Counting…</p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Users className="size-5 text-accent" />
                    <div>
                      <div className="text-lg font-semibold" data-testid="reachable">
                        {preview.reachable.toLocaleString("en-NG")} {preview.reachable === 1 ? "person" : "people"}
                      </div>
                      <div className="text-xs text-muted">
                        {preview.sample.slice(0, 3).join(", ")}
                        {preview.reachable > 3 ? ` and ${(preview.reachable - 3).toLocaleString("en-NG")} more` : ""}
                      </div>
                    </div>
                  </div>
                  {Object.keys(preview.skipped).length > 0 && (
                    <details className="rounded-lg bg-surface-2 px-3 py-2">
                      <summary className="cursor-pointer text-muted">
                        {Object.values(preview.skipped).reduce((s, n) => s + n, 0)} won&apos;t get it
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
                        {Object.entries(preview.skipped).map(([k, n]) => (
                          <li key={k} className="flex justify-between gap-2">
                            <span>{SKIP[k]}</span>
                            <b className="tabular">{n}</b>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {channel === "sms" && (
                    <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                      <span className="text-muted">SMS units</span>
                      <span className={cn("tabular font-medium", short && "text-bad")}>
                        {units.toLocaleString("en-NG")} of {balance.toLocaleString("en-NG")}
                        <span className="font-normal text-faint"> · about {naira(units * unitPriceKobo)}</span>
                      </span>
                    </div>
                  )}
                  {short && (
                    <Note tone="bad" icon={<AlertTriangle className="size-4" />}>
                      Not enough units.{" "}
                      {canBuy ? (
                        <Link href="/messages/wallet" className="font-medium underline">
                          Buy more
                        </Link>
                      ) : (
                        "Ask an administrator to buy more."
                      )}
                    </Note>
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="ghost" onClick={() => setTesting(true)} disabled={!body.trim()}>
                  <FlaskConical /> Send me a test
                </Button>
                <Button variant="primary" className="ml-auto" disabled={!canSend} onClick={() => setConfirming(true)}>
                  {schedule ? <CalendarClock /> : <Send />} {schedule ? "Schedule" : "Send"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        {confirming && preview && (
          <DialogContent
            title={`${schedule ? "Schedule" : "Send"} to ${preview.reachable.toLocaleString("en-NG")} ${preview.reachable === 1 ? "person" : "people"}?`}
            description={
              channel === "sms"
                ? `Uses about ${units.toLocaleString("en-NG")} SMS unit${units === 1 ? "" : "s"}, leaving ${(balance - units).toLocaleString("en-NG")}.`
                : schedule
                  ? "You can cancel it any time before it sends."
                  : "Messages start going out straight away."
            }
            footer={
              <>
                <Button onClick={() => setConfirming(false)}>Not yet</Button>
                <Button
                  variant="primary"
                  loading={send.pending}
                  onClick={() =>
                    send.run({
                      channel,
                      subject: channel === "email" ? subject : undefined,
                      body,
                      audience,
                      scheduleAt: schedule && when ? lagosToIso(when) : undefined,
                    })
                  }
                >
                  <Send /> {schedule ? "Schedule it" : "Send now"}
                </Button>
              </>
            }
          >
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] whitespace-pre-wrap">{channel === "sms" ? info.text : sample}</div>
            {schedule && when && (
              <Badge tone="accent">
                <CalendarClock className="size-3" />{" "}
                {new Date(lagosToIso(when)).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "full", timeStyle: "short" })}
              </Badge>
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={testing} onOpenChange={setTesting}>
        {testing && (
          <DialogContent
            title="Send yourself a test"
            description={channel === "sms" ? "Uses SMS units like any other message." : "Check how it looks before everyone gets it."}
            footer={
              <>
                <Button onClick={() => setTesting(false)}>Cancel</Button>
                <Button variant="primary" loading={test.pending} onClick={() => test.run({ channel, subject, body, to: testTo || undefined })}>
                  <FlaskConical /> Send test
                </Button>
              </>
            }
          >
            <Field
              label={channel === "email" ? "Email" : "Phone number"}
              htmlFor="t-to"
              error={test.fieldErrors.to}
              optional={channel === "email" || hasPhone}
              hint={channel === "email" ? "Leave empty to use your account email." : hasPhone ? "Leave empty to use the number on your account." : undefined}
            >
              <Input
                id="t-to"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                inputMode={channel === "email" ? "email" : "tel"}
                placeholder={channel === "email" ? "you@example.com" : "0803 123 4567"}
              />
            </Field>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
