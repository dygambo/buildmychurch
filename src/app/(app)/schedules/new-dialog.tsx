"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FilePlus2, LayoutTemplate, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { formatDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { removeTemplateAction, startScheduleAction } from "./actions";
import { TYPES } from "./labels";

type Template = { id: string; name: string; serviceType: string; items: number };
type Recent = { id: string; title: string; serviceDate: string };

/** The coming Sunday in Lagos, as YYYY-MM-DD. */
function nextSunday() {
  const d = new Date(`${todayISO()}T12:00:00+01:00`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

export function NewScheduleDialog({
  open,
  onOpenChange,
  templates,
  recent,
  branches,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: Template[];
  recent: Recent[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState<"template" | "copy" | "blank">(templates.length ? "template" : "blank");
  const [templateId, setTemplateId] = useState((templates.find((t) => t.serviceType === "sunday") ?? templates[0])?.id ?? "");
  const [copyOf, setCopyOf] = useState(recent[0]?.id ?? "");
  const [date, setDate] = useState(nextSunday());
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const start = useAction(startScheduleAction, { onSuccess: (d) => router.push(`/schedules/${d.id}`) });
  const remove = useAction(removeTemplateAction, { onSuccess: () => router.refresh() });
  const tabs = [
    { k: "template" as const, label: "From a template", icon: LayoutTemplate },
    { k: "copy" as const, label: "Copy an earlier one", icon: Copy },
    { k: "blank" as const, label: "Blank", icon: FilePlus2 },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          wide
          title="New service schedule"
          description="It starts as a draft. Nothing is sent until you publish."
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={start.pending}
                onClick={() => start.run({ from, templateId: from === "template" ? templateId : null, copyOf: from === "copy" ? copyOf : null, serviceDate: date, branchId })}
              >
                Create draft
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1" role="radiogroup" aria-label="Start from">
            {tabs.map((t) => (
              <button
                key={t.k}
                type="button"
                role="radio"
                aria-checked={from === t.k}
                onClick={() => setFrom(t.k)}
                disabled={(t.k === "copy" && !recent.length) || (t.k === "template" && !templates.length)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium disabled:opacity-50",
                  from === t.k ? "border-accent bg-accent-soft text-accent" : "border-line-strong hover:bg-surface-2",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
          {from === "template" && (
            <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line" role="radiogroup" aria-label="Template">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-[13px]">
                    <input type="radio" name="tpl" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} className="accent-[var(--accent)]" />
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-faint">
                      {TYPES[t.serviceType]} · {t.items} items
                    </span>
                  </label>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove template ${t.name}`} onClick={() => remove.run({ id: t.id })}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {from === "copy" && (
            <Field label="Copy" htmlFor="ns-copy" hint="The programme and people are copied. Theme and scripture start empty.">
              <Select id="ns-copy" value={copyOf} onChange={(e) => setCopyOf(e.target.value)}>
                {recent.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}, {formatDate(r.serviceDate)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="Service date" htmlFor="ns-date" error={start.fieldErrors.serviceDate}>
              <Input id="ns-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {branches.length > 1 && (
              <Field label="Branch" htmlFor="ns-branch">
                <Select id="ns-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
