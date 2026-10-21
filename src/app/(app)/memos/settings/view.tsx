"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { archiveMemoTemplateAction, saveMemoTemplateAction, saveRouteAction } from "../actions";
import { CATEGORY } from "../labels";

type Step = { label: string; roleKey: string; minAmount: string };
type T = { id: string; name: string; category: string; subject: string; body: string; needsAmount: boolean };

export function MemoSettingsView({ prefix: p0, steps: s0, roles, templates }: { prefix: string; steps: Step[]; roles: { key: string; name: string }[]; templates: T[] }) {
  const router = useRouter();
  const [prefix, setPrefix] = useState(p0);
  const [steps, setSteps] = useState<Step[]>(s0);
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const save = useAction(saveRouteAction, { onSuccess: () => router.refresh() });
  const remove = useAction(archiveMemoTemplateAction, { onSuccess: () => router.refresh() });
  const set = (i: number, patch: Partial<Step>) => setSteps((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, to: number) =>
    setSteps((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(to, 0, x!);
      return n;
    });
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/memos">
            <ArrowLeft /> E-Memo
          </Link>
        </Button>
      </div>
      <PageHeader title="Memo route and templates" description="Who approves memos, in what order, and from what amount." />
      <Card>
        <CardHeader title="Approval route" />
        <CardBody className="flex flex-col gap-3">
          <Field label="Reference prefix" htmlFor="ms-prefix" error={save.fieldErrors.prefix} hint={`Memos are numbered ${prefix || "CHURCH"}/MEMO/${new Date().getFullYear()}/001, 002…`} className="max-w-xs">
            <Input id="ms-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
          </Field>
          <ol className="flex flex-col gap-2">
            {steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[24px_minmax(0,1.2fr)_minmax(0,1fr)_140px_auto] items-end gap-2 rounded-lg border border-line p-2.5 max-md:grid-cols-2">
                <span className="mb-2 text-center text-xs font-semibold text-muted max-md:col-span-2 max-md:text-left">Step {i + 1}</span>
                <Field label="Name" htmlFor={`st-l-${i}`} error={save.fieldErrors[`steps.${i}.label`]}>
                  <Input id={`st-l-${i}`} value={s.label} onChange={(e) => set(i, { label: e.target.value })} />
                </Field>
                <Field label="Approved by" htmlFor={`st-r-${i}`} error={save.fieldErrors[`steps.${i}.roleKey`]}>
                  <Select id={`st-r-${i}`} value={s.roleKey} onChange={(e) => set(i, { roleKey: e.target.value })}>
                    <option value="">Choose a role…</option>
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Only from (₦)" htmlFor={`st-m-${i}`} optional>
                  <Input id={`st-m-${i}`} inputMode="decimal" value={s.minAmount} onChange={(e) => set(i, { minAmount: e.target.value })} placeholder="Every memo" />
                </Field>
                <div className="flex">
                  <Button size="icon-sm" variant="ghost" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, i + 1)}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps((l) => l.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <Note>
            Steps with an amount only apply to memos asking for at least that much. If no one holds a step&apos;s role (or only the person who raised the memo), the step is skipped. Nobody approves their own memo.
          </Note>
          <div className="flex gap-2">
            <Button onClick={() => setSteps((l) => [...l, { label: "", roleKey: "", minAmount: "" }])} disabled={steps.length >= 8}>
              <Plus /> Add step
            </Button>
            <Button variant="primary" className="ml-auto" loading={save.pending} onClick={() => save.run({ prefix, steps })}>
              <Save /> Save route
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Templates"
          action={
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> New template
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted">
                  {CATEGORY[t.category]}
                  {t.needsAmount ? " · asks for an amount" : ""}
                </div>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                <Pencil />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => remove.run({ id: t.id })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <TemplateDialog t={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TemplateDialog({ t, onClose }: { t: T | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const x = t && t !== "new" ? t : null;
  const act = useAction(saveMemoTemplateAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={!!t} onOpenChange={(o) => !o && onClose()}>
      {t && (
        <DialogContent
          wide
          title={x ? `Edit ${x.name}` : "New memo template"}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="mt-form" variant="primary" loading={act.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="mt-form"
            key={x?.id ?? "new"}
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act.run({
                id: x?.id,
                name: String(f.get("name")),
                category: String(f.get("category")) as "general",
                subject: String(f.get("subject")),
                body: String(f.get("body")),
                needsAmount: f.get("needsAmount") === "on",
              });
            }}
          >
            <Field label="Name" htmlFor="mt-name" error={act.fieldErrors.name}>
              <Input id="mt-name" name="name" defaultValue={x?.name} />
            </Field>
            <Field label="Kind" htmlFor="mt-cat">
              <Select id="mt-cat" name="category" defaultValue={x?.category ?? "general"}>
                {Object.entries(CATEGORY).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject starts with" htmlFor="mt-sub" className="col-span-full">
              <Input id="mt-sub" name="subject" defaultValue={x?.subject} />
            </Field>
            <Field label="Body" htmlFor="mt-body" error={act.fieldErrors.body} className="col-span-full">
              <Textarea id="mt-body" name="body" rows={8} defaultValue={x?.body} />
            </Field>
            <Checkbox name="needsAmount" defaultChecked={x?.needsAmount} label="Ask for an amount" className="col-span-full" />
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
