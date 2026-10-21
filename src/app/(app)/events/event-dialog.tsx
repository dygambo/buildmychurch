"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { saveEventAction } from "./actions";

export type EventInitial = {
  id?: string;
  branchId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  capacity: number | null;
  closesAt: string | null;
  askPhone: boolean;
  tickets: { id?: string; name: string; price: string; capacity: string }[];
};

/** Date → "2026-11-20T18:00" in Lagos time, for datetime-local inputs. */
export const toLocal = (d: Date | string | null) => {
  if (!d) return "";
  const t = new Date(new Date(d).getTime() + 3600_000);
  return t.toISOString().slice(0, 16);
};

export function EventDialog({
  open,
  onOpenChange,
  initial,
  branches,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: EventInitial;
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initial?.tickets ?? [{ name: "General admission", price: "0", capacity: "" }]);
  const save = useAction(saveEventAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      if (!initial?.id) router.push(`/events/${d.id}`);
      else router.refresh();
    },
  });
  const fe = save.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          wide
          title={initial?.id ? "Edit event" : "New event"}
          description="It stays a draft until you open registration."
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" form="event-form" variant="primary" loading={save.pending}>
                {initial?.id ? "Save" : "Create event"}
              </Button>
            </>
          }
        >
          <form
            id="event-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const g = (k: string) => String(f.get(k) ?? "");
              save.run({
                id: initial?.id,
                branchId: g("branchId"),
                title: g("title"),
                description: g("description"),
                startsAt: g("startsAt"),
                endsAt: g("endsAt"),
                venue: g("venue"),
                capacity: g("capacity"),
                closesAt: g("closesAt"),
                askPhone: f.get("askPhone") === "on",
                tickets,
              } as Parameters<typeof saveEventAction>[0]);
            }}
          >
            <Field label="Event name" htmlFor="ev-title" error={fe.title} className="col-span-full">
              <Input id="ev-title" name="title" defaultValue={initial?.title} placeholder="e.g. Youth Conference 2026" />
            </Field>
            <Field label="Starts" htmlFor="ev-start" error={fe.startsAt}>
              <Input id="ev-start" name="startsAt" type="datetime-local" defaultValue={initial?.startsAt} />
            </Field>
            <Field label="Ends" htmlFor="ev-end" error={fe.endsAt} optional>
              <Input id="ev-end" name="endsAt" type="datetime-local" defaultValue={initial?.endsAt ?? ""} />
            </Field>
            <Field label="Venue" htmlFor="ev-venue" optional>
              <Input id="ev-venue" name="venue" defaultValue={initial?.venue ?? ""} />
            </Field>
            <Field label="Total places" htmlFor="ev-cap" error={fe.capacity} optional hint="Leave empty for no limit.">
              <Input id="ev-cap" name="capacity" inputMode="numeric" defaultValue={initial?.capacity ?? ""} />
            </Field>
            <Field label="Registration closes" htmlFor="ev-close" error={fe.closesAt} optional>
              <Input id="ev-close" name="closesAt" type="datetime-local" defaultValue={initial?.closesAt ?? ""} />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" htmlFor="ev-br">
                <Select id="ev-br" name="branchId" defaultValue={initial?.branchId}>
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
            <Field label="About the event" htmlFor="ev-desc" optional className="col-span-full">
              <Textarea id="ev-desc" name="description" rows={4} defaultValue={initial?.description ?? ""} />
            </Field>
            <fieldset className="col-span-full flex flex-col gap-2">
              <legend className="mb-1 text-[12.5px] font-medium text-muted">Tickets</legend>
              {fe.tickets && <p className="text-xs text-bad">{fe.tickets}</p>}
              {tickets.map((t, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px_100px_auto] items-end gap-2 max-sm:grid-cols-2">
                  <Field label="Ticket" htmlFor={`tk-n-${i}`} error={fe[`tickets.${i}.name`]}>
                    <Input id={`tk-n-${i}`} value={t.name} onChange={(e) => setTickets((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </Field>
                  <Field label="Price (₦)" htmlFor={`tk-p-${i}`} error={fe[`tickets.${i}.price`]}>
                    <Input id={`tk-p-${i}`} inputMode="decimal" value={t.price} onChange={(e) => setTickets((l) => l.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                  </Field>
                  <Field label="Places" htmlFor={`tk-c-${i}`} optional>
                    <Input id={`tk-c-${i}`} inputMode="numeric" value={t.capacity} onChange={(e) => setTickets((l) => l.map((x, j) => (j === i ? { ...x, capacity: e.target.value } : x)))} />
                  </Field>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ticket ${i + 1}`} disabled={tickets.length === 1} onClick={() => setTickets((l) => l.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" className="self-start" onClick={() => setTickets((l) => [...l, { name: "", price: "0", capacity: "" }])} disabled={tickets.length >= 10}>
                <Plus /> Add ticket type
              </Button>
              <p className="text-xs text-faint">Enter 0 for free tickets. Paid tickets are paid online into the church&apos;s account and counted in giving.</p>
            </fieldset>
            <Checkbox name="askPhone" defaultChecked={initial?.askPhone ?? true} label="Ask for a phone number" className="col-span-full" />
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
