"use client";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/card";
import { formToObject, useAction } from "@/components/ui/use-action";
import { naira, todayISO } from "@/lib/format";
import { saveExpenseAction } from "./actions";
import { METHODS } from "./labels";

export type Option = { id: string; name: string };
export type ExpenseFormValues = {
  id?: string;
  branchId: string;
  categoryId: string;
  fundId: string | null;
  payee: string;
  description: string;
  amountKobo: number;
  spentOn: string;
  method: string;
  paymentRef: string | null;
  note: string | null;
};

export function ExpenseDialog({
  open,
  onOpenChange,
  initial,
  branches,
  categories,
  funds,
  thresholdKobo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ExpenseFormValues;
  branches: Option[];
  categories: Option[];
  funds: (Option & { restricted: boolean })[];
  thresholdKobo: number;
}) {
  const router = useRouter();
  const save = useAction(saveExpenseAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      if (!initial?.id) router.push(`/expenses/${d.id}`);
    },
  });
  const submit = (e: React.FormEvent<HTMLFormElement>, send: boolean) => {
    e.preventDefault();
    const v = formToObject(e.currentTarget) as Record<string, string>;
    save.run({ ...v, id: initial?.id, submit: send } as Parameters<typeof saveExpenseAction>[0]);
  };
  const fe = save.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          wide
          title={initial?.id ? "Edit expense" : "Record an expense"}
          description={
            thresholdKobo > 0
              ? `Up to ${naira(thresholdKobo)} approves itself when submitted. Anything more needs a pastor to approve.`
              : "Every expense needs someone other than you to approve it."
          }
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" form="expense-form" name="intent" value="draft" loading={save.pending}>
                Save draft
              </Button>
              <Button type="submit" form="expense-form" name="intent" value="submit" variant="primary" loading={save.pending}>
                <Send /> Save and submit
              </Button>
            </>
          }
        >
          <form
            id="expense-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              const intent = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
              submit(e, intent === "submit");
            }}
          >
            <Field label="Paid to" htmlFor="x-payee" error={fe.payee} className="col-span-full">
              <Input id="x-payee" name="payee" defaultValue={initial?.payee} placeholder="e.g. Ikeja Electric, Total Filling Station" required />
            </Field>
            <Field label="What for" htmlFor="x-desc" error={fe.description} className="col-span-full">
              <Input id="x-desc" name="description" defaultValue={initial?.description} placeholder="e.g. Diesel for Sunday services" required />
            </Field>
            <Field label="Amount (₦)" htmlFor="x-amount" error={fe.amount}>
              <Input
                id="x-amount"
                name="amount"
                inputMode="decimal"
                className="tabular"
                defaultValue={initial ? (initial.amountKobo / 100).toString() : ""}
                required
              />
            </Field>
            <Field label="Date" htmlFor="x-date" error={fe.spentOn}>
              <Input id="x-date" name="spentOn" type="date" max={todayISO()} defaultValue={initial?.spentOn ?? todayISO()} required />
            </Field>
            <Field label="Category" htmlFor="x-cat" error={fe.categoryId}>
              <Select id="x-cat" name="categoryId" defaultValue={initial?.categoryId ?? ""} required>
                <option value="" disabled>
                  Choose…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid from fund" htmlFor="x-fund" error={fe.fundId} optional>
              <Select id="x-fund" name="fundId" defaultValue={initial?.fundId ?? ""}>
                <option value="">Not charged to a fund</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.restricted ? " (restricted)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How it was or will be paid" htmlFor="x-method" error={fe.method}>
              <Select id="x-method" name="method" defaultValue={initial?.method ?? "transfer"}>
                {Object.entries(METHODS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment reference" htmlFor="x-ref" error={fe.paymentRef} optional>
              <Input id="x-ref" name="paymentRef" defaultValue={initial?.paymentRef ?? ""} placeholder="Transfer or cheque number" />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" htmlFor="x-branch" error={fe.branchId} className="col-span-full">
                <Select id="x-branch" name="branchId" defaultValue={initial?.branchId ?? branches[0]?.id}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={initial?.branchId ?? branches[0]?.id ?? ""} />
            )}
            <Field label="Notes" htmlFor="x-note" error={fe.note} optional className="col-span-full">
              <Textarea id="x-note" name="note" rows={2} defaultValue={initial?.note ?? ""} />
            </Field>
            <Note className="col-span-full">You can attach the receipt or invoice on the next screen.</Note>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
