"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formToObject, useAction } from "@/components/ui/use-action";
import { naira, todayISO } from "@/lib/format";
import type { FinanceSettings } from "@/server/services/expenses";
import { COLOR_VAR, toKobo, toNairaInput } from "../../giving/labels";
import { archiveCategoryAction, saveCategoryAction, saveOpeningAction, saveRulesAction } from "../actions";

type Cat = { id: string; name: string; code: string; description: string | null; color: string; archived: boolean };

export function FinanceSettingsView({
  settings,
  categories,
  funds,
}: {
  settings: FinanceSettings;
  categories: Cat[];
  funds: { id: string; name: string; restricted: boolean }[];
}) {
  const router = useRouter();
  const rules = useAction(saveRulesAction, { onSuccess: () => router.refresh() });
  const opening = useAction(saveOpeningAction, { onSuccess: () => router.refresh() });
  const archive = useAction(archiveCategoryAction, { onSuccess: () => router.refresh() });
  const [balances, setBalances] = useState<Record<string, string>>(() =>
    Object.fromEntries(funds.map((f) => [f.id, toNairaInput(settings.openingBalances[f.id] ?? 0)])),
  );
  const [openingDate, setOpeningDate] = useState(settings.openingDate ?? todayISO());
  const [editing, setEditing] = useState<Cat | "new" | null>(null);
  return (
    <>
      <PageHeader title="Finance settings" description="Approval limits, branch remittances, opening balances and expense categories." />
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader title="Approvals and remittances" />
          <CardBody>
            <form
              id="rules"
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                rules.run(formToObject(e.currentTarget) as Parameters<typeof saveRulesAction>[0]);
              }}
            >
              <Field
                label="Expenses approve themselves up to (₦)"
                htmlFor="fs-th"
                error={rules.fieldErrors.approvalThreshold}
                hint="Anything above needs a pastor or Super Admin who didn't raise it. Enter 0 to approve every expense by hand."
              >
                <Input id="fs-th" name="approvalThreshold" inputMode="decimal" className="tabular" defaultValue={String(settings.approvalThresholdKobo / 100)} />
              </Field>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="Branches send headquarters (%)" htmlFor="fs-rate" error={rules.fieldErrors.remittancePercent}>
                  <Input id="fs-rate" name="remittancePercent" inputMode="decimal" defaultValue={String(settings.remittanceBps / 100)} />
                </Field>
                <Field label="Of" htmlFor="fs-basis">
                  <Select id="fs-basis" name="remittanceBasis" defaultValue={settings.remittanceBasis}>
                    <option value="unrestricted">General income (not restricted funds)</option>
                    <option value="all">All income</option>
                  </Select>
                </Field>
              </div>
              <div>
                <Button type="submit" variant="primary" loading={rules.pending}>
                  <Save /> Save
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Opening balances" />
          <CardBody className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">
              What each fund held before you started recording here, from your bank statements or last accounts. Fund balances count from this date.
            </p>
            <Field label="As at" htmlFor="ob-date" error={opening.fieldErrors.openingDate}>
              <Input id="ob-date" type="date" max={todayISO()} value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="w-44" />
            </Field>
            <div className="flex flex-col gap-2">
              {funds.map((f) => (
                <div key={f.id} className="flex items-center gap-3">
                  <label htmlFor={`ob-${f.id}`} className="flex-1 text-[13px]">
                    {f.name}
                    {f.restricted && <span className="text-faint"> (restricted)</span>}
                  </label>
                  <Input
                    id={`ob-${f.id}`}
                    inputMode="decimal"
                    className="tabular h-8 w-40 text-right"
                    value={balances[f.id] ?? ""}
                    placeholder="0"
                    onChange={(e) => setBalances((b) => ({ ...b, [f.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="tabular text-[13px] text-muted">
                Total {naira(Object.values(balances).reduce((s, v) => s + toKobo(v), 0))}
              </span>
              <Button
                variant="primary"
                loading={opening.pending}
                onClick={() =>
                  opening.run({
                    openingDate,
                    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, String(toKobo(v) / 100)])),
                  })
                }
              >
                <Save /> Save balances
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Expense categories"
          action={
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> Add category
            </Button>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th className="max-sm:hidden">Code</Th>
              <Th className="w-40" />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <Tr key={c.id} className={c.archived ? "opacity-60" : undefined}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-sm" style={{ background: COLOR_VAR[c.color] }} />
                    <span className="font-medium">{c.name}</span>
                    {c.archived && <Badge>Closed</Badge>}
                  </span>
                  {c.description && <div className="text-xs text-muted">{c.description}</div>}
                </Td>
                <Td className="font-mono text-xs max-sm:hidden">{c.code}</Td>
                <Td className="text-right">
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => archive.run({ id: c.id, archived: !c.archived })}>
                    {c.archived ? "Reopen" : "Close"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <CategoryDialog cat={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CategoryDialog({ cat, onClose }: { cat: Cat | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const c = cat && cat !== "new" ? cat : null;
  const save = useAction(saveCategoryAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={!!cat} onOpenChange={(o) => !o && onClose()}>
      {cat && (
        <DialogContent
          title={c ? `Edit ${c.name}` : "Add a category"}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="cat-form" variant="primary" loading={save.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="cat-form"
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.run({ ...(formToObject(e.currentTarget) as Record<string, string>), id: c?.id } as Parameters<typeof saveCategoryAction>[0]);
            }}
          >
            <Field label="Name" htmlFor="c-name" error={save.fieldErrors.name} className="col-span-full">
              <Input id="c-name" name="name" defaultValue={c?.name} required />
            </Field>
            <Field label="Code" htmlFor="c-code" error={save.fieldErrors.code}>
              <Input id="c-code" name="code" defaultValue={c?.code} className="uppercase" required />
            </Field>
            <Field label="Colour" htmlFor="c-color">
              <Select id="c-color" name="color" defaultValue={c?.color ?? "c1"}>
                {["c1", "c2", "c3", "c4", "c5", "c6"].map((k, i) => (
                  <option key={k} value={k}>
                    {["Blue", "Pink", "Teal", "Amber", "Purple", "Sky"][i]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="c-desc" optional className="col-span-full">
              <Input id="c-desc" name="description" defaultValue={c?.description ?? ""} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
