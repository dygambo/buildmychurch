"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, ExternalLink, Inbox, MoreHorizontal, Plus, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import type { FormField } from "@/server/db/schema/care";
import type { getForm } from "@/server/services/forms";
import { FormFields } from "@/app/(public)/f/[token]/form";
import { deleteFormAction, duplicateFormAction, formStatusAction, saveFormAction } from "../actions";
import { FORM_STATUS } from "../view";

type F = Awaited<ReturnType<typeof getForm>>;

const TYPES: [FormField["type"], string][] = [
  ["short", "Short answer"],
  ["long", "Paragraph"],
  ["phone", "Phone number"],
  ["email", "Email"],
  ["choice", "One choice"],
  ["multi", "Several choices"],
  ["yesno", "Yes or no"],
  ["date", "Date"],
  ["number", "Number"],
  ["section", "Section heading"],
];

const newId = () => Math.random().toString(36).slice(2, 10);
const toLocal = (d: Date | null) => (d ? new Date(new Date(d).getTime() + 3600_000).toISOString().slice(0, 16) : "");

export function FormBuilder({ f }: { f: F }) {
  const router = useRouter();
  const [title, setTitle] = useState(f.title);
  const [description, setDescription] = useState(f.description ?? "");
  const [fields, setFields] = useState<FormField[]>(f.fields);
  const [closesAt, setClosesAt] = useState(toLocal(f.closesAt));
  const [maxResponses, setMax] = useState(f.maxResponses ? String(f.maxResponses) : "");
  const [oneEach, setOneEach] = useState(f.oneEach);
  const [thankYou, setThankYou] = useState(f.thankYou ?? "");
  const [notifyEmail, setNotify] = useState(f.notifyEmail ?? "");
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  const save = useAction(saveFormAction, {
    onSuccess: () => {
      setDirty(false);
      router.refresh();
    },
  });
  const status = useAction(formStatusAction, { onSuccess: () => router.refresh() });
  const dup = useAction(duplicateFormAction, { onSuccess: (d) => router.push(`/forms/${d.id}`) });
  const del = useAction(deleteFormAction, { onSuccess: () => router.push("/forms") });
  const fe = save.fieldErrors;
  const payload = () => ({ id: f.id, title, description, fields, closesAt, maxResponses, oneEach, thankYou, notifyEmail });
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const set = (i: number, patch: Partial<FormField>) => {
    setFields((l) => l.map((q, j) => (j === i ? { ...q, ...patch } : q)));
    touch();
  };
  const move = (i: number, d: -1 | 1) => {
    setFields((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x!);
      return n;
    });
    touch();
  };
  const add = (type: FormField["type"]) => {
    setFields((l) => [...l, { id: newId(), type, label: "", required: type !== "section", options: type === "choice" || type === "multi" ? ["Option 1", "Option 2"] : undefined }]);
    touch();
  };
  const st = FORM_STATUS[f.status];
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/forms">
            <ArrowLeft /> Forms
          </Link>
        </Button>
      </div>
      <PageHeader
        title={f.title}
        description={`${f.responses} ${f.responses === 1 ? "response" : "responses"}`}
        actions={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            <Button variant="ghost" asChild>
              <Link href={`/forms/${f.id}/responses`}>
                <Inbox /> Responses
              </Link>
            </Button>
            <Button onClick={() => save.run(payload() as never)} loading={save.pending} variant={dirty ? "primary" : "secondary"}>
              {dirty ? "Save" : "Saved"}
            </Button>
            {f.status !== "open" ? (
              <Button variant="primary" disabled={dirty} loading={status.pending} onClick={() => status.run({ id: f.id, status: "open" })} title={dirty ? "Save first" : undefined}>
                <Send /> Open form
              </Button>
            ) : (
              <Button loading={status.pending} onClick={() => status.run({ id: f.id, status: "closed" })}>
                Close form
              </Button>
            )}
            <Dropdown>
              <DropdownTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end">
                <DropdownItem onSelect={() => dup.run({ id: f.id })}>
                  <Copy /> Make a copy
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem danger onSelect={() => del.run({ id: f.id })}>
                  <Trash2 /> Delete form
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          </>
        }
      />
      {f.status === "open" && f.publicUrl && (
        <Card>
          <CardBody className="flex items-center gap-4 max-sm:flex-col max-sm:items-start">
            <QrImage value={f.publicUrl} size={96} label="QR code for the form" />
            <div className="flex min-w-0 flex-col gap-2 text-[13px]">
              <span className="font-medium">Share this link or print the QR code</span>
              <code className="truncate rounded bg-surface-2 px-2 py-1 font-mono text-xs">{f.publicUrl}</code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    navigator.clipboard.writeText(f.publicUrl!).then(
                      () => toast.success("Link copied"),
                      () => toast.error("Couldn't copy the link"),
                    )
                  }
                >
                  <Copy /> Copy link
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={f.publicUrl} target="_blank" rel="noopener">
                    <ExternalLink /> Open
                  </a>
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
      <div className="grid grid-cols-[1fr_380px] gap-4 max-xl:grid-cols-1">
        <div className="flex flex-col gap-3">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <Field label="Title" htmlFor="fm-title" error={fe.title}>
                <Input id="fm-title" value={title} onChange={(e) => (setTitle(e.target.value), touch())} />
              </Field>
              <Field label="Description" htmlFor="fm-desc" optional>
                <Textarea id="fm-desc" rows={2} value={description} onChange={(e) => (setDescription(e.target.value), touch())} />
              </Field>
            </CardBody>
          </Card>
          {fe.fields && <Note tone="bad">{fe.fields}</Note>}
          {fields.map((q, i) => (
            <Card key={q.id} data-testid="form-question">
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 text-xs font-semibold text-faint tabular">{i + 1}</span>
                  <Field label={q.type === "section" ? "Heading" : "Question"} htmlFor={`q-l-${q.id}`} error={fe[`fields.${i}.label`]} className="flex-1">
                    <Input id={`q-l-${q.id}`} value={q.label} onChange={(e) => set(i, { label: e.target.value })} placeholder={q.type === "section" ? "e.g. About you" : "e.g. Which department?"} />
                  </Field>
                  <Field label="Type" htmlFor={`q-t-${q.id}`} className="w-40">
                    <Select
                      id={`q-t-${q.id}`}
                      value={q.type}
                      onChange={(e) => {
                        const type = e.target.value as FormField["type"];
                        set(i, { type, options: type === "choice" || type === "multi" ? (q.options?.length ? q.options : ["Option 1", "Option 2"]) : undefined, required: type === "section" ? false : q.required });
                      }}
                    >
                      {TYPES.map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {(q.type === "choice" || q.type === "multi") && (
                  <Field label="Choices, one per line" htmlFor={`q-o-${q.id}`} error={fe[`fields.${i}.options`]}>
                    <Textarea id={`q-o-${q.id}`} rows={Math.min(8, (q.options?.length ?? 2) + 1)} value={(q.options ?? []).join("\n")} onChange={(e) => set(i, { options: e.target.value.split("\n") })} onBlur={() => set(i, { options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) })} />
                  </Field>
                )}
                <Field label="Help text" htmlFor={`q-h-${q.id}`} optional>
                  <Input id={`q-h-${q.id}`} value={q.help ?? ""} onChange={(e) => set(i, { help: e.target.value })} />
                </Field>
                <div className="flex items-center gap-1">
                  {q.type !== "section" && <Checkbox label="Required" checked={!!q.required} onChange={(e) => set(i, { required: e.target.checked })} />}
                  <span className="ml-auto" />
                  <Button size="icon-sm" variant="ghost" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Move question ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => (setFields((l) => l.filter((_, j) => j !== i)), touch())}>
                    <Trash2 />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
          <Card>
            <CardBody className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] font-medium">Add</span>
              {TYPES.map(([k, v]) => (
                <Button key={k} size="sm" variant="ghost" onClick={() => add(k)}>
                  <Plus /> {v}
                </Button>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Settings" />
            <CardBody className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Close automatically" htmlFor="fm-close" optional>
                <Input id="fm-close" type="datetime-local" value={closesAt} onChange={(e) => (setClosesAt(e.target.value), touch())} />
              </Field>
              <Field label="Stop after this many responses" htmlFor="fm-max" optional error={fe.maxResponses}>
                <Input id="fm-max" inputMode="numeric" value={maxResponses} onChange={(e) => (setMax(e.target.value), touch())} />
              </Field>
              <Field label="Email me each new response" htmlFor="fm-notify" optional error={fe.notifyEmail} hint="The email says who replied, not their answers.">
                <Input id="fm-notify" type="email" value={notifyEmail} onChange={(e) => (setNotify(e.target.value), touch())} />
              </Field>
              <Field label="Thank-you message" htmlFor="fm-thanks" optional>
                <Input id="fm-thanks" value={thankYou} onChange={(e) => (setThankYou(e.target.value), touch())} placeholder="e.g. See you at the first class on Saturday!" />
              </Field>
              <div className="col-span-full">
                <Checkbox label="One response per person (matched by phone or email)" checked={oneEach} onChange={(e) => (setOneEach(e.target.checked), touch())} />
                {fe.oneEach && <p className="mt-1 text-xs text-bad">{fe.oneEach}</p>}
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="max-xl:hidden">
          <Card className="sticky top-4">
            <CardHeader title="Preview" />
            <CardBody className="flex flex-col gap-4" data-testid="form-preview">
              <div>
                <div className="text-lg font-semibold">{title || "Untitled form"}</div>
                {description && <p className="text-[13px] whitespace-pre-wrap text-muted">{description}</p>}
              </div>
              <FormFields fields={fields.filter((q) => q.label)} errors={{}} preview />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
