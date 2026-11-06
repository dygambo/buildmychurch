"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { formToObject, useAction } from "@/components/ui/use-action";
import { saveCampaignAction } from "../actions";
import { toNairaInput } from "../labels";

export type CampaignValues = {
  id?: string;
  name: string;
  description: string | null;
  fundId: string;
  goalKobo: number;
  startsOn: string | null;
  endsOn: string | null;
  showOnline: boolean;
};

export function CampaignDialog({
  open,
  onOpenChange,
  funds,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  funds: { id: string; name: string; restricted: boolean }[];
  initial?: CampaignValues;
}) {
  const router = useRouter();
  const save = useAction(saveCampaignAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      if (!initial) router.push(`/giving/pledges/${d.id}`);
    },
  });
  const restricted = funds.find((f) => f.restricted);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={initial ? "Edit project" : "New project"}
          description="A building project, a bus, a mission: anything people pledge towards."
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="campaign-form" loading={save.pending}>
                {initial ? "Save" : "Create project"}
              </Button>
            </>
          }
        >
          <form
            id="campaign-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formToObject(e.currentTarget);
              save.run({ ...v, id: initial?.id } as Parameters<typeof saveCampaignAction>[0]);
            }}
          >
            <Field label="Project name" htmlFor="c-name" error={save.fieldErrors.name} className="col-span-full">
              <Input id="c-name" name="name" required defaultValue={initial?.name} placeholder="e.g. New Auditorium" />
            </Field>
            <Field label="Goal (₦)" htmlFor="c-goal" error={save.fieldErrors.goal}>
              <Input id="c-goal" name="goal" inputMode="decimal" required defaultValue={toNairaInput(initial?.goalKobo ?? 0)} placeholder="85,000,000" />
            </Field>
            <Field label="Gifts go into" htmlFor="c-fund" error={save.fieldErrors.fundId}>
              <Select id="c-fund" name="fundId" defaultValue={initial?.fundId ?? restricted?.id ?? funds[0]?.id}>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Starts" htmlFor="c-start" optional>
              <Input id="c-start" name="startsOn" type="date" defaultValue={initial?.startsOn ?? ""} />
            </Field>
            <Field label="Target date" htmlFor="c-end" error={save.fieldErrors.endsOn} optional>
              <Input id="c-end" name="endsOn" type="date" defaultValue={initial?.endsOn ?? ""} />
            </Field>
            <Field label="About this project" htmlFor="c-desc" optional className="col-span-full">
              <Textarea id="c-desc" name="description" rows={3} defaultValue={initial?.description ?? ""} />
            </Field>
            <Checkbox
              name="showOnline"
              defaultChecked={initial?.showOnline ?? true}
              label="Show on the online giving page, with its progress bar"
              className="col-span-full"
            />
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
