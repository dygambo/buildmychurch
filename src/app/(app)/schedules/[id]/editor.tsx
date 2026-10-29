"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  GripVertical,
  History,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatDateTime } from "@/lib/format";
import { itemClock, timeProblems, to12 } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import {
  archiveAction,
  deleteAction,
  duplicateAction,
  findPeopleAction,
  publishAction,
  publishPreviewAction,
  saveScheduleAction,
  saveTemplateAction,
} from "../actions";
import { REASON, statusOf, SUGGESTED_ITEMS, TYPES } from "../labels";

type Assignee = { memberId: string | null; userId: string | null; groupId: string | null; name: string; responsibility: string | null };
type ItemIn = {
  title: string;
  startTime: string | null;
  durationMin: number | null;
  description: string | null;
  notes: string | null;
  custom: { label: string; value: string }[];
  assignees: Assignee[];
};
type Item = Omit<ItemIn, "durationMin"> & { key: string; durationMin: string; open: boolean };
type S = {
  id: string;
  branchId: string;
  title: string;
  serviceType: string;
  typeLabel: string | null;
  serviceDate: string;
  startTime: string;
  endTime: string | null;
  venue: string | null;
  theme: string | null;
  scripture: string | null;
  presidingName: string | null;
  presidingMemberId: string | null;
  announcements: string | null;
  internalNotes: string | null;
  status: string;
  currentVersion: number;
  hasChanges: boolean;
  createdByName: string;
  updatedByName: string | null;
  updatedAt: string;
  lastPublishedAt: string | null;
  items: ItemIn[];
};
type Details = Omit<S, "items" | "status" | "currentVersion" | "hasChanges" | "createdByName" | "updatedByName" | "updatedAt" | "lastPublishedAt" | "id">;

let seq = 0;
const newKey = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;
const toItem = (i: ItemIn): Item => ({ ...i, key: newKey(), durationMin: i.durationMin ? String(i.durationMin) : "", open: false });
const blank = (title = ""): Item => ({
  key: newKey(),
  title,
  startTime: null,
  durationMin: "",
  description: null,
  notes: null,
  custom: [],
  assignees: [],
  open: !title,
});

export function ScheduleEditor({
  s,
  branches,
  failed,
  church,
}: {
  s: S;
  branches: { id: string; name: string }[];
  failed: number;
  church: string;
}) {
  const router = useRouter();
  const [d, setD] = useState<Details>(() => ({
    branchId: s.branchId,
    title: s.title,
    serviceType: s.serviceType,
    typeLabel: s.typeLabel,
    serviceDate: s.serviceDate,
    startTime: s.startTime,
    endTime: s.endTime,
    venue: s.venue,
    theme: s.theme,
    scripture: s.scripture,
    presidingName: s.presidingName,
    presidingMemberId: s.presidingMemberId,
    announcements: s.announcements,
    internalNotes: s.internalNotes,
  }));
  const [items, setItems] = useState<Item[]>(() => s.items.map(toItem));
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | "publish" | "template" | "delete">(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);

  const set = <K extends keyof Details>(k: K, v: Details[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const setItem = (i: number, patch: Partial<Item>) => {
    setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    if (!("open" in patch && Object.keys(patch).length === 1)) setDirty(true);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((list) => {
      const next = [...list];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return next;
    });
    setDirty(true);
  };

  const payload = useCallback(
    () => ({
      id: s.id,
      ...d,
      items: items.map((i) => ({
        title: i.title,
        startTime: i.startTime || null,
        durationMin: i.durationMin === "" ? null : Number(i.durationMin),
        description: i.description,
        notes: i.notes,
        custom: i.custom,
        assignees: i.assignees,
      })),
    }),
    [s.id, d, items],
  );

  const problems = useMemo(
    () =>
      timeProblems({
        startTime: d.startTime,
        endTime: d.endTime,
        items: items.map((i) => ({ title: i.title, startTime: i.startTime, durationMin: i.durationMin === "" ? null : Number(i.durationMin) })),
      }),
    [d.startTime, d.endTime, items],
  );
  const clock = useMemo(
    () => itemClock(d.startTime, items.map((i) => ({ startTime: i.startTime, durationMin: i.durationMin === "" ? null : Number(i.durationMin) }))),
    [d.startTime, items],
  );

  const save = useAction(saveScheduleAction, {
    onSuccess: () => {
      setDirty(false);
      router.refresh();
    },
  });
  const fe = { ...problems, ...save.fieldErrors };
  const doSave = useCallback(() => {
    if (!save.pending) save.run(payload() as Parameters<typeof saveScheduleAction>[0]);
  }, [save, payload]);

  // warn before leaving with unsaved changes; Ctrl/Cmd+S saves
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("keydown", key);
    };
  }, [dirty, doSave]);

  const dup = useAction(duplicateAction, { onSuccess: (r) => router.push(`/schedules/${r.id}`) });
  const archive = useAction(archiveAction, { onSuccess: () => router.refresh() });
  const st = statusOf(s);
  const archived = s.status === "archived";
  const totalMin = items.reduce((t, i) => t + (Number(i.durationMin) || 0), 0);
  const people = new Set(items.flatMap((i) => i.assignees.map((a) => a.memberId ?? a.userId ?? a.groupId ?? a.name))).size;
  const canPublish = !archived && !dirty && (s.currentVersion === 0 || s.hasChanges) && items.length > 0 && !Object.keys(problems).length;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!dirty || confirm("You have unsaved changes. Leave without saving?")) router.push("/schedules");
          }}
        >
          <ArrowLeft /> Schedules
        </Button>
        {s.currentVersion > 0 && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/schedules/${s.id}?tab=history`}>
              <History /> Versions and notifications
              {failed > 0 && <Badge tone="bad">{failed} failed</Badge>}
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold max-sm:text-[19px]">{d.title || "Untitled service"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span>
              {formatDate(d.serviceDate, "long")}, {to12(d.startTime)}
            </span>
            <span className="text-faint">
              Created by {s.createdByName}
              {s.updatedByName ? ` · last edited by ${s.updatedByName}, ${formatDateTime(s.updatedAt)}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="lg:hidden" onClick={() => setPreview((p) => !p)}>
            <Eye /> {preview ? "Edit" : "Preview"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (dirty) return alert("Save your changes first, then preview the PDF.");
              window.open(`/schedules/${s.id}/pdf?preview=1`, "_blank", "noopener");
            }}
          >
            <FileText /> Preview PDF
          </Button>
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => dup.run({ id: s.id })}>
                <Copy /> Copy for next week
              </DropdownItem>
              <DropdownItem onSelect={() => setDialog("template")}>
                <LayoutTemplate /> Save as template
              </DropdownItem>
              {s.currentVersion > 0 && (
                <DropdownItem asChild>
                  <a href={`/schedules/${s.id}/pdf`} target="_blank" rel="noopener">
                    <FileText /> Download published PDF
                  </a>
                </DropdownItem>
              )}
              <DropdownItem onSelect={() => archive.run({ id: s.id, archived: !archived })}>
                {archived ? <Undo2 /> : <Archive />} {archived ? "Restore" : "Archive"}
              </DropdownItem>
              <DropdownItem danger onSelect={() => setDialog("delete")}>
                <Trash2 /> Delete
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </div>

      {archived && <Note>This schedule is archived. Restore it to edit or publish.</Note>}
      {s.hasChanges && !dirty && (
        <Note tone="warn">
          You&apos;ve saved changes that people haven&apos;t seen. Publish to send version {s.currentVersion + 1} to those affected.
        </Note>
      )}

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className={cn("flex flex-col gap-4", preview && "max-lg:hidden")}>
          <Card>
            <CardHeader title="Service details" />
            <CardBody>
              <fieldset disabled={archived} className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="Title" htmlFor="sd-title" error={fe.title} className="col-span-full">
                  <Input id="sd-title" value={d.title} onChange={(e) => set("title", e.target.value)} />
                </Field>
                <Field label="Type of service" htmlFor="sd-type">
                  <Select id="sd-type" value={d.serviceType} onChange={(e) => set("serviceType", e.target.value)}>
                    {Object.entries(TYPES).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={d.serviceType === "custom" ? "What kind of service?" : "Programme name"}
                  htmlFor="sd-label"
                  error={fe.typeLabel}
                  optional={d.serviceType !== "custom"}
                >
                  <Input
                    id="sd-label"
                    value={d.typeLabel ?? ""}
                    onChange={(e) => set("typeLabel", e.target.value || null)}
                    placeholder={d.serviceType === "custom" ? "e.g. Ordination service" : "e.g. Harvest Thanksgiving"}
                  />
                </Field>
                <Field label="Date" htmlFor="sd-date" error={fe.serviceDate}>
                  <Input id="sd-date" type="date" value={d.serviceDate} onChange={(e) => set("serviceDate", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Starts" htmlFor="sd-start" error={fe.startTime}>
                    <Input id="sd-start" type="time" value={d.startTime} onChange={(e) => set("startTime", e.target.value)} />
                  </Field>
                  <Field label="Ends" htmlFor="sd-end" error={fe.endTime} optional>
                    <Input id="sd-end" type="time" value={d.endTime ?? ""} onChange={(e) => set("endTime", e.target.value || null)} />
                  </Field>
                </div>
                <Field label="Venue" htmlFor="sd-venue" optional>
                  <Input id="sd-venue" value={d.venue ?? ""} onChange={(e) => set("venue", e.target.value || null)} />
                </Field>
                <Field label="Presiding minister or coordinator" htmlFor="sd-pres" optional>
                  <Input id="sd-pres" value={d.presidingName ?? ""} onChange={(e) => set("presidingName", e.target.value || null)} />
                </Field>
                <Field label="Theme" htmlFor="sd-theme" optional>
                  <Input id="sd-theme" value={d.theme ?? ""} onChange={(e) => set("theme", e.target.value || null)} />
                </Field>
                <Field label="Scripture" htmlFor="sd-scr" optional>
                  <Input id="sd-scr" value={d.scripture ?? ""} onChange={(e) => set("scripture", e.target.value || null)} placeholder="e.g. Psalm 100:4" />
                </Field>
                {branches.length > 1 && (
                  <Field label="Branch" htmlFor="sd-branch">
                    <Select id="sd-branch" value={d.branchId} onChange={(e) => set("branchId", e.target.value)}>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </fieldset>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`Programme (${items.length})`}
              action={
                <span className="text-xs text-muted">
                  {totalMin ? `${Math.floor(totalMin / 60) ? `${Math.floor(totalMin / 60)} h ` : ""}${totalMin % 60} min planned · ` : ""}
                  {people} {people === 1 ? "person" : "people"}
                </span>
              }
            />
            <div className="flex flex-col">
              {items.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-muted">No items yet. Add the parts of the service below, in any order.</p>
              )}
              {items.map((it, i) => {
                const err = (k: string) => fe[`items.${i}.${k}`];
                const hasErr = Object.keys(fe).some((k) => k.startsWith(`items.${i}.`));
                return (
                  <div
                    key={it.key}
                    data-testid="programme-item"
                    onDragOver={(e) => {
                      if (dragging === null) return;
                      e.preventDefault();
                      if (dragging !== i) {
                        move(dragging, i);
                        setDragging(i);
                      }
                    }}
                    className={cn("border-t border-line px-3 py-2.5", dragging === i && "bg-accent-soft", hasErr && "bg-bad-soft/40")}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        draggable={!archived}
                        onDragStart={() => setDragging(i)}
                        onDragEnd={() => setDragging(null)}
                        className="mt-2 cursor-grab text-faint hover:text-fg max-sm:hidden"
                        aria-label={`Drag ${it.title || "item"} to reorder`}
                        tabIndex={-1}
                      >
                        <GripVertical className="size-4" />
                      </button>
                      <span className="tabular mt-2 w-14 shrink-0 text-xs font-medium text-muted">{clock[i]?.start ? to12(clock[i]!.start) : "—"}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            aria-label={`Item ${i + 1} name`}
                            value={it.title}
                            onChange={(e) => setItem(i, { title: e.target.value })}
                            placeholder="e.g. Praise and worship"
                            className="h-8 min-w-40 flex-1 font-medium"
                            disabled={archived}
                          />
                          <Input
                            aria-label={`Item ${i + 1} minutes`}
                            inputMode="numeric"
                            value={it.durationMin}
                            onChange={(e) => setItem(i, { durationMin: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                            placeholder="min"
                            className={cn("h-8 w-16 text-right", err("durationMin") && "border-bad")}
                            disabled={archived}
                          />
                        </div>
                        <Assignees
                          list={it.assignees}
                          disabled={archived}
                          onChange={(assignees) => setItem(i, { assignees })}
                          label={it.title || `item ${i + 1}`}
                        />
                        {(err("title") || err("startTime") || err("durationMin")) && (
                          <p className="flex items-center gap-1 text-xs text-bad">
                            <AlertTriangle className="size-3" /> {err("title") ?? err("startTime") ?? err("durationMin")}
                          </p>
                        )}
                        {it.open && (
                          <div className="mt-1 grid grid-cols-2 gap-2.5 rounded-lg bg-surface-2 p-2.5 max-sm:grid-cols-1">
                            <Field label="Fixed start time" htmlFor={`it-st-${it.key}`} optional hint="Leave empty to follow the item before.">
                              <Input
                                id={`it-st-${it.key}`}
                                type="time"
                                value={it.startTime ?? ""}
                                onChange={(e) => setItem(i, { startTime: e.target.value || null })}
                                disabled={archived}
                              />
                            </Field>
                            <div />
                            <Field label="Instructions (printed)" htmlFor={`it-d-${it.key}`} optional className="col-span-full">
                              <Textarea
                                id={`it-d-${it.key}`}
                                rows={2}
                                value={it.description ?? ""}
                                onChange={(e) => setItem(i, { description: e.target.value || null })}
                                disabled={archived}
                              />
                            </Field>
                            <Field label="Private notes (not printed or sent)" htmlFor={`it-n-${it.key}`} optional className="col-span-full">
                              <Textarea
                                id={`it-n-${it.key}`}
                                rows={2}
                                value={it.notes ?? ""}
                                onChange={(e) => setItem(i, { notes: e.target.value || null })}
                                disabled={archived}
                              />
                            </Field>
                            <div className="col-span-full flex flex-col gap-1.5">
                              {it.custom.map((c, k) => (
                                <div key={k} className="flex items-center gap-2">
                                  <Input
                                    aria-label="Field name"
                                    value={c.label}
                                    placeholder="e.g. Hymn number"
                                    className="h-8 w-36"
                                    onChange={(e) => setItem(i, { custom: it.custom.map((x, y) => (y === k ? { ...x, label: e.target.value } : x)) })}
                                  />
                                  <Input
                                    aria-label="Field value"
                                    value={c.value}
                                    placeholder="e.g. 247"
                                    className="h-8 flex-1"
                                    onChange={(e) => setItem(i, { custom: it.custom.map((x, y) => (y === k ? { ...x, value: e.target.value } : x)) })}
                                  />
                                  <Button size="icon-sm" variant="ghost" aria-label="Remove field" onClick={() => setItem(i, { custom: it.custom.filter((_, y) => y !== k) })}>
                                    <X />
                                  </Button>
                                </div>
                              ))}
                              {it.custom.length < 10 && !archived && (
                                <button
                                  type="button"
                                  className="self-start text-xs font-medium text-accent"
                                  onClick={() => setItem(i, { custom: [...it.custom, { label: "", value: "" }] })}
                                >
                                  + Add a field (hymn number, song key, reading…)
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button size="icon-sm" variant="ghost" aria-label={`Move ${it.title || "item"} up`} disabled={i === 0 || archived} onClick={() => move(i, i - 1)}>
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Move ${it.title || "item"} down`}
                          disabled={i === items.length - 1 || archived}
                          onClick={() => move(i, i + 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${it.title || "item"}`} disabled={archived}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownTrigger>
                          <DropdownContent>
                            <DropdownItem onSelect={() => setItem(i, { open: !it.open })}>
                              {it.open ? <ChevronDown /> : <ChevronRight />} {it.open ? "Hide details" : "Time, instructions, fields"}
                            </DropdownItem>
                            <DropdownItem
                              onSelect={() => {
                                setItems((l) => [...l.slice(0, i + 1), { ...it, key: newKey(), assignees: [...it.assignees] }, ...l.slice(i + 1)]);
                                setDirty(true);
                              }}
                            >
                              <Copy /> Duplicate
                            </DropdownItem>
                            <DropdownItem
                              danger
                              onSelect={() => {
                                setItems((l) => l.filter((_, j) => j !== i));
                                setDirty(true);
                              }}
                            >
                              <Trash2 /> Remove
                            </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={it.open ? `Hide details of ${it.title || "item"}` : `Show details of ${it.title || "item"}`}
                          onClick={() => setItem(i, { open: !it.open })}
                        >
                          {it.open ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!archived && (
                <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
                  <Button
                    variant="soft"
                    className="self-start"
                    onClick={() => {
                      setItems((l) => [...l, blank()]);
                      setDirty(true);
                    }}
                  >
                    <Plus /> Add item
                  </Button>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_ITEMS.filter((t) => !items.some((i) => i.title === t)).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setItems((l) => [...l, blank(t)]);
                          setDirty(true);
                        }}
                        className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Notes" />
            <CardBody className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Announcements and instructions" htmlFor="sd-ann" optional hint="Printed on the PDF and sent to everyone on the programme.">
                <Textarea id="sd-ann" rows={4} value={d.announcements ?? ""} onChange={(e) => set("announcements", e.target.value || null)} disabled={archived} />
              </Field>
              <Field label="Private notes" htmlFor="sd-int" optional hint="Only coordinators see these. Never printed or sent.">
                <Textarea id="sd-int" rows={4} value={d.internalNotes ?? ""} onChange={(e) => set("internalNotes", e.target.value || null)} disabled={archived} />
              </Field>
            </CardBody>
          </Card>
        </div>

        <div className={cn("sticky top-4 flex flex-col gap-4 max-lg:static", !preview && "max-lg:hidden")}>
          <Card>
            <CardHeader title="Live preview" action={<span className="text-xs text-faint">As it will print</span>} />
            <CardBody className="text-[13px]">
              <div className="border-b-2 border-accent pb-2">
                <div className="text-xs font-semibold">{church}</div>
              </div>
              <div className="mt-3 text-[10px] font-semibold tracking-wider text-accent uppercase">
                {d.typeLabel || TYPES[d.serviceType]?.replace("Other (name it)", "Service")}
              </div>
              <div className="text-base font-semibold">{d.title || "Untitled service"}</div>
              <div className="mt-1 text-xs text-muted">
                {formatDate(d.serviceDate, "long")}, {to12(d.startTime)}
                {d.endTime ? ` – ${to12(d.endTime)}` : ""}
                {d.venue ? ` · ${d.venue}` : ""}
              </div>
              {(d.theme || d.scripture) && (
                <div className="mt-1 text-xs">
                  {d.theme && <span className="italic">“{d.theme}”</span>}
                  {d.scripture && <span className="text-muted"> · {d.scripture}</span>}
                </div>
              )}
              <ol className="mt-3 flex flex-col divide-y divide-line border-y border-line" data-testid="live-preview">
                {items.map((it, i) => (
                  <li key={it.key} className="grid grid-cols-[60px_minmax(0,1fr)] gap-2 py-1.5">
                    <span className="tabular text-xs font-semibold">{clock[i]?.start ? to12(clock[i]!.start) : ""}</span>
                    <span>
                      <span className="font-medium">{it.title || "Untitled item"}</span>
                      {it.assignees.length > 0 && <span className="text-muted"> — {it.assignees.map((a) => a.name).join(", ")}</span>}
                      {it.description && <span className="block text-xs text-muted">{it.description}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {d.announcements && <p className="mt-2 text-xs whitespace-pre-wrap text-muted">{d.announcements}</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className={cn("text-[13px]", dirty ? "font-medium text-warn" : "text-muted")} data-testid="save-state">
          {dirty ? "Unsaved changes" : s.currentVersion ? `Version ${s.currentVersion} published${s.lastPublishedAt ? ` ${formatDateTime(s.lastPublishedAt)}` : ""}` : "Draft saved"}
        </span>
        {Object.keys(problems).length > 0 && (
          <span className="flex items-center gap-1 text-xs text-bad">
            <AlertTriangle className="size-3.5" /> {Object.values(problems)[0]}
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <Button loading={save.pending} disabled={!dirty || archived} onClick={doSave}>
            <Save /> Save
          </Button>
          <Button variant="primary" disabled={!canPublish} onClick={() => setDialog("publish")} title={dirty ? "Save first" : undefined}>
            <Send /> {s.currentVersion ? `Publish update (v${s.currentVersion + 1})` : "Publish"}
          </Button>
        </span>
      </div>

      <PublishDialog id={s.id} open={dialog === "publish"} onClose={() => setDialog(null)} first={s.currentVersion === 0} />
      <TemplateDialog id={s.id} title={d.title} open={dialog === "template"} onClose={() => setDialog(null)} />
      <DeleteDialog id={s.id} published={s.currentVersion > 0} open={dialog === "delete"} onClose={() => setDialog(null)} />
    </>
  );
}

/* ---------- people on an item ---------- */

type Found = { kind: "member" | "user" | "group"; id: string; name: string; hint: string | null };

function Assignees({ list, onChange, disabled, label }: { list: Assignee[]; onChange: (l: Assignee[]) => void; disabled: boolean; label: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((a, k) => (
        <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2 text-xs">
          {a.groupId ? <Users className="size-3 text-faint" /> : <UserRound className="size-3 text-faint" />}
          <span className="truncate font-medium">{a.name}</span>
          <input
            aria-label={`${a.name}'s responsibility`}
            value={a.responsibility ?? ""}
            onChange={(e) => onChange(list.map((x, y) => (y === k ? { ...x, responsibility: e.target.value || null } : x)))}
            placeholder="role"
            disabled={disabled}
            className="w-16 bg-transparent text-muted outline-none placeholder:text-faint focus:w-28"
          />
          {!disabled && (
            <button type="button" aria-label={`Remove ${a.name}`} className="rounded-full p-0.5 text-faint hover:bg-surface-3 hover:text-fg" onClick={() => onChange(list.filter((_, y) => y !== k))}>
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled &&
        (adding ? (
          <PersonSearch
            label={label}
            exclude={list}
            onPick={(a) => {
              onChange([...list, a]);
              setAdding(false);
            }}
            onClose={() => setAdding(false)}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent">
            + Assign
          </button>
        ))}
    </div>
  );
}

function PersonSearch({ label, exclude, onPick, onClose }: { label: string; exclude: Assignee[]; onPick: (a: Assignee) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seqRef = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [onClose]);
  const taken = (f: Found) => exclude.some((a) => (f.kind === "member" ? a.memberId : f.kind === "user" ? a.userId : a.groupId) === f.id);
  const shown = results.filter((r) => !taken(r));
  const options: (Found | { kind: "typed"; name: string })[] = [...shown, ...(q.trim().length >= 2 ? [{ kind: "typed" as const, name: q.trim() }] : [])];
  const pick = (o: (typeof options)[number]) =>
    onPick({
      memberId: o.kind === "member" ? o.id : null,
      userId: o.kind === "user" ? o.id : null,
      groupId: o.kind === "group" ? o.id : null,
      name: o.name,
      responsibility: null,
    });
  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-faint" />
      <input
        autoFocus
        type="search"
        aria-label={`Find someone for ${label}`}
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          clearTimeout(t.current);
          if (v.trim().length < 2) return setResults([]);
          t.current = setTimeout(async () => {
            const mine = ++seqRef.current;
            const r = await findPeopleAction({ q: v });
            if (mine !== seqRef.current) return;
            setResults(r.ok ? r.data : []);
            setActive(0);
          }, 200);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, options.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && options[active]) {
            e.preventDefault();
            pick(options[active]!);
          }
        }}
        placeholder="Name of member, staff or group"
        className="h-7 w-60 rounded-full border border-accent bg-surface pr-2 pl-7 text-xs outline-none"
      />
      {options.length > 0 && (
        <ul role="listbox" className="absolute top-8 left-0 z-20 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {options.map((o, k) => (
            <li key={o.kind === "typed" ? "typed" : `${o.kind}-${o.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={k === active}
                onMouseEnter={() => setActive(k)}
                onClick={() => pick(o)}
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]", k === active && "bg-surface-2")}
              >
                {o.kind === "group" ? <Users className="size-3.5 text-faint" /> : <UserRound className="size-3.5 text-faint" />}
                <span className="min-w-0 flex-1 truncate">{o.kind === "typed" ? `Add “${o.name}”` : o.name}</span>
                <span className="shrink-0 text-xs text-faint">
                  {o.kind === "typed" ? "guest, not notified" : o.kind === "user" ? `Team · ${o.hint ?? ""}` : o.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- dialogs ---------- */

type Preview = { version: number; summary: string; changes: { key: string; name: string; reason: string; detail: string }[] };

function PublishDialog({ id, open, onClose, first }: { id: string; open: boolean; onClose: () => void; first: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Preview | null>(null);
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState("");
  const load = useAction(publishPreviewAction);
  const pub = useAction(publishAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const run = load.run;
  useEffect(() => {
    if (!open) return;
    run({ id }).then((r) => r?.ok && setData(r.data));
  }, [open, id, run]);
  const shown = open ? data : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title={first ? "Publish this schedule?" : `Publish version ${shown?.version ?? ""}?`}
          description={shown?.summary}
          footer={
            <>
              <Button onClick={onClose}>Not yet</Button>
              <Button variant="primary" loading={pub.pending} disabled={!shown} onClick={() => pub.run({ id, notify, note: note || null })}>
                <Send /> Publish
              </Button>
            </>
          }
        >
          {!shown ? (
            <p className="text-[13px] text-muted">Checking who needs to know…</p>
          ) : (
            <>
              <p className="text-[13px] text-muted">
                A PDF is made for this version.{" "}
                {shown.changes.length
                  ? first
                    ? "Everyone on the programme gets their part by email (with the PDF), or by SMS if there's no email."
                    : "Only the people whose part changed are told:"
                  : "No one's part changed, so no one needs to be told."}
              </p>
              {shown.changes.length > 0 && (
                <ul className="flex max-h-56 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line text-[13px]">
                  {shown.changes.map((c) => (
                    <li key={c.key} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge tone={c.reason === "removed" ? "bad" : c.reason === "changed" ? "warn" : "accent"}>{REASON[c.reason]}</Badge>
                      </div>
                      <div className="line-clamp-2 text-xs text-muted">{c.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
              {shown.changes.length > 0 && <Checkbox label="Send notifications" checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
              {!first && (
                <Field label="Note for the record" htmlFor="pub-note" optional hint="Kept with this version, e.g. why it changed.">
                  <Input id="pub-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              )}
              <p className="text-xs text-faint">Guests typed in by name aren&apos;t notified. Choose them from the member list or team to send their part.</p>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function TemplateDialog({ id, title, open, onClose }: { id: string; title: string; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(title);
  const act = useAction(saveTemplateAction, { onSuccess: onClose });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Save as a template"
          description="The programme, times and notes are saved, without people's names. Save your changes first."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={act.pending} onClick={() => act.run({ id, name })}>
                Save template
              </Button>
            </>
          }
        >
          <Field label="Template name" htmlFor="tpl-name" error={act.fieldErrors.name}>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </DialogContent>
      )}
    </Dialog>
  );
}

function DeleteDialog({ id, published, open, onClose }: { id: string; published: boolean; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const act = useAction(deleteAction, { onSuccess: () => router.push("/schedules") });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title="Delete this schedule?"
          footer={
            <>
              <Button onClick={onClose}>Keep it</Button>
              <Button variant="danger" loading={act.pending} onClick={() => act.run({ id })}>
                <Trash2 /> Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-muted">
            It disappears from the list and its share link stops working.
            {published ? " Published versions and their PDFs stay in the audit record." : ""} People who were notified aren&apos;t told. Archive it instead to keep it searchable.
          </p>
        </DialogContent>
      )}
    </Dialog>
  );
}
