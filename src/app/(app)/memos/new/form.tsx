"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Lock, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MemberPicker } from "../../members/member-picker";
import { saveMemoAction } from "../actions";
import { CATEGORY } from "../labels";

type T = { id: string; name: string; category: string; subject: string; body: string; needsAmount: boolean };
type Initial = {
  id: string;
  branchId: string;
  templateId: string | null;
  category?: string;
  title?: string;
  body?: string;
  amount?: string;
  departmentId?: string | null;
  memberId?: string | null;
  memberName?: string | null;
  urgent?: boolean;
  confidential?: boolean;
  status: string;
};

export function MemoForm({
  initial,
  templates,
  route,
  groups,
  branches,
  canPickMember,
}: {
  initial: Initial;
  templates: T[];
  route: { label: string; minAmountKobo: number }[];
  groups: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  canPickMember: boolean;
}) {
  const router = useRouter();
  const startT = templates.find((t) => t.id === initial.templateId);
  const [templateId, setTemplateId] = useState<string | null>(initial.templateId);
  const [category, setCategory] = useState(initial.category ?? startT?.category ?? "general");
  const [title, setTitle] = useState(initial.title ?? startT?.subject ?? "");
  const [body, setBody] = useState(initial.body ?? startT?.body ?? "");
  const [amount, setAmount] = useState(initial.amount ?? "");
  const [departmentId, setDepartmentId] = useState(initial.departmentId ?? "");
  const [member, setMember] = useState<{ id: string; name: string } | null>(initial.memberId ? { id: initial.memberId, name: initial.memberName ?? "" } : null);
  const [urgent, setUrgent] = useState(!!initial.urgent);
  const [confidential, setConfidential] = useState(!!initial.confidential);
  const [branchId, setBranchId] = useState(initial.branchId);
  const [dirty, setDirty] = useState(false);
  const editing = !!initial.title;
  const query = initial.status === "query";
  const tpl = templates.find((t) => t.id === templateId);
  const kobo = Math.round(Number(amount.replace(/[₦,\s]/g, "")) * 100) || 0;
  const path = useMemo(() => route.filter((r) => !r.minAmountKobo || kobo >= r.minAmountKobo), [route, kobo]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);

  const save = useAction(saveMemoAction, {
    onSuccess: (d) => {
      setDirty(false);
      router.push(`/memos/${d.id}`);
    },
  });
  const run = (send: boolean) =>
    save.run({
      id: initial.id,
      branchId,
      templateId,
      category: category as "general",
      title,
      body,
      amount,
      departmentId,
      memberId: member?.id ?? "",
      urgent,
      confidential,
      send: send && !query,
    });
  const touch = <V,>(set: (v: V) => void) => (v: V) => {
    set(v);
    setDirty(true);
  };
  const fe = save.fieldErrors;

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={editing ? `/memos/${initial.id}` : "/memos"}>
            <ArrowLeft /> {editing ? "Back to the memo" : "E-Memo"}
          </Link>
        </Button>
      </div>
      <PageHeader
        title={query ? "Update the memo" : editing ? "Edit draft" : "New memo"}
        description={query ? "Make the changes the approver asked for, then answer the query on the memo." : "Saved as a draft until you send it. You can attach quotes and receipts after saving."}
      />
      {!editing && templates.length > 0 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of memo">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={templateId === t.id}
              onClick={() => {
                setTemplateId(t.id);
                setCategory(t.category);
                if (!title || templates.some((x) => x.subject === title)) setTitle(t.subject);
                if (!body || templates.some((x) => x.body === body)) setBody(t.body);
                setDirty(true);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[13px]",
                templateId === t.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong bg-surface text-muted hover:text-fg",
              )}
            >
              {t.name}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={templateId === null}
            onClick={() => {
              setTemplateId(null);
              setCategory("general");
            }}
            className={cn("rounded-full border px-3 py-1.5 text-[13px]", templateId === null ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong text-muted")}
          >
            Blank memo
          </button>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <Card>
          <CardBody className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="Subject" htmlFor="mm-title" error={fe.title} className="col-span-full">
              <Input id="mm-title" value={title} onChange={(e) => touch(setTitle)(e.target.value)} placeholder="e.g. Request for funds: Youth Week publicity" />
            </Field>
            <Field label="Kind" htmlFor="mm-cat">
              <Select id="mm-cat" value={category} onChange={(e) => touch(setCategory)(e.target.value)}>
                {Object.entries(CATEGORY).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount requested (₦)" htmlFor="mm-amt" error={fe.amount} optional={!tpl?.needsAmount}>
              <Input id="mm-amt" inputMode="decimal" className="tabular" value={amount} onChange={(e) => touch(setAmount)(e.target.value)} placeholder="Leave empty if no money is needed" />
            </Field>
            <Field label="From department" htmlFor="mm-dept" optional>
              <Select id="mm-dept" value={departmentId} onChange={(e) => touch(setDepartmentId)(e.target.value)}>
                <option value="">Not from a department</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" htmlFor="mm-br">
                <Select id="mm-br" value={branchId} onChange={(e) => touch(setBranchId)(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div />
            )}
            {canPickMember && (
              <Field label="About a member" htmlFor="mm-member" optional className="col-span-full" hint="For welfare requests: approvers can open their record.">
                {member ? (
                  <span className="inline-flex items-center gap-2 self-start rounded-full bg-surface-2 py-1 pr-1 pl-3 text-[13px]">
                    {member.name}
                    <button type="button" aria-label="Remove member" onClick={() => touch(setMember)(null)} className="rounded-full p-0.5 hover:bg-surface-3">
                      <X className="size-3.5" />
                    </button>
                  </span>
                ) : (
                  <MemberPicker onPick={(m) => touch(setMember)({ id: m.id, name: m.name })} placeholder="Search members" />
                )}
              </Field>
            )}
            <Field label="Details" htmlFor="mm-body" error={fe.body} className="col-span-full">
              <Textarea id="mm-body" rows={12} value={body} onChange={(e) => touch(setBody)(e.target.value)} />
            </Field>
            <div className="col-span-full flex flex-col gap-2 border-t border-line pt-3">
              <Checkbox
                label="Urgent: approvers are also told by SMS"
                checked={urgent}
                onChange={(e) => touch(setUrgent)(e.target.checked)}
              />
              <Checkbox
                label="Confidential: only the approvers on its path can open it"
                checked={confidential}
                onChange={(e) => touch(setConfidential)(e.target.checked)}
              />
            </div>
          </CardBody>
        </Card>
        <div className="sticky top-4 flex flex-col gap-4 max-lg:static">
          <Card>
            <CardHeader title="Who approves it" />
            <CardBody className="flex flex-col gap-3 text-[13px]">
              <ol className="flex flex-wrap items-center gap-1.5" data-testid="memo-path">
                <li className="rounded-md bg-surface-2 px-2 py-1">You</li>
                {path.map((r) => (
                  <li key={r.label} className="flex items-center gap-1.5">
                    <ArrowRight className="size-3.5 text-faint" />
                    <span className="rounded-md bg-accent-soft px-2 py-1 font-medium text-accent">{r.label}</span>
                  </li>
                ))}
                {kobo > 0 && (
                  <li className="flex items-center gap-1.5">
                    <ArrowRight className="size-3.5 text-faint" />
                    <span className="rounded-md bg-good-soft px-2 py-1 text-good">Finance pays</span>
                  </li>
                )}
              </ol>
              {route.some((r) => r.minAmountKobo > 0 && kobo < r.minAmountKobo) && (
                <p className="text-xs text-muted">
                  {route
                    .filter((r) => r.minAmountKobo > 0 && kobo < r.minAmountKobo)
                    .map((r) => `${r.label} also approves from ${naira(r.minAmountKobo)}`)
                    .join(". ")}
                  .
                </p>
              )}
              {confidential && (
                <Note icon={<Lock className="size-4" />}>Hidden from everyone except the people above and leaders allowed to open confidential memos.</Note>
              )}
              {urgent && (
                <Note tone="warn" icon={<AlertTriangle className="size-4" />}>
                  Approvers get an SMS as well as an email.
                </Note>
              )}
            </CardBody>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button loading={save.pending} onClick={() => run(false)}>
              <Save /> {query ? "Save changes" : "Save draft"}
            </Button>
            {!query && (
              <Button variant="primary" loading={save.pending} onClick={() => run(true)} className="flex-1 justify-center">
                <Send /> Send for approval
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
