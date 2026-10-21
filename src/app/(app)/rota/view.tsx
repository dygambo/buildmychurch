"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, ChevronLeft, ChevronRight, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RotaSlot } from "@/server/services/rota";
import { addSlotAction, assignAction, fillAction, removeSlotAction } from "./actions";

type Group = { id: string; name: string; kind: string; members: { id: string; name: string }[] };

const TONE: Record<string, string> = {
  open: "border-dashed border-line-strong text-faint",
  assigned: "border-line bg-surface",
  confirmed: "border-good/40 bg-good-soft text-good",
  declined: "border-bad/40 bg-bad-soft text-bad",
};

export function RotaView({ dates, groups, slots, groupId }: { dates: string[]; groups: Group[]; slots: RotaSlot[]; groupId: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [filling, setFilling] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ groupId: string; date: string } | null>(null);
  const assign = useAction(assignAction, { onSuccess: () => router.refresh() });
  const remove = useAction(removeSlotAction, { onSuccess: () => router.refresh() });
  const go = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const shift = (weeks: number) => go("from", new Date(new Date(`${dates[0]}T12:00:00Z`).getTime() + weeks * 7 * 86400_000).toISOString().slice(0, 10));
  const shown = groups
    .filter((g) => !groupId || g.id === groupId)
    .sort((a, b) => Number(slots.some((s) => s.groupId === b.id)) - Number(slots.some((s) => s.groupId === a.id)));
  const declined = slots.filter((s) => s.status === "declined").length;
  const open = slots.filter((s) => s.status === "open").length;
  return (
    <>
      <PageHeader
        title="Volunteer rota"
        description="Who serves where each Sunday. Volunteers confirm from their message, get a reminder the evening before, and you hear when someone can't make it."
        actions={
          <>
            <Select aria-label="Department" value={groupId} onChange={(e) => go("group", e.target.value)} className="w-48">
              <option value="">All departments</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button variant="primary" onClick={() => setFilling(groupId || groups[0]?.id || "")} disabled={!groups.length}>
              <Sparkles /> Fill the rota
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => shift(-4)} aria-label="Earlier weeks">
          <ChevronLeft />
        </Button>
        <span className="text-[13px] font-medium">
          {formatDate(dates[0]!, "short")} – {formatDate(dates[3]!, "year")}
        </span>
        <Button size="sm" variant="ghost" onClick={() => shift(4)} aria-label="Later weeks">
          <ChevronRight />
        </Button>
        <span className="ml-auto flex gap-3 text-xs text-muted">
          {open > 0 && <span>{open} open</span>}
          {declined > 0 && <span className="text-bad">{declined} need cover</span>}
        </span>
      </div>
      {!groups.length ? (
        <Card>
          <EmptyState icon={<CalendarRange />} title="Add departments first">
            Create departments (ushering, choir, media, protocol) in Groups and add their members. Then fill the rota here.
          </EmptyState>
        </Card>
      ) : (
        shown.map((g) => {
          const gs = slots.filter((s) => s.groupId === g.id);
          const positions = [...new Set(gs.map((s) => s.position))];
          return (
            <Card key={g.id}>
              <CardHeader
                title={g.name}
                action={
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {g.members.length} members
                    <Button size="sm" variant="ghost" onClick={() => setFilling(g.id)}>
                      <Sparkles /> Fill
                    </Button>
                  </span>
                }
              />
              {positions.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing planned for these weeks. Use Fill to assign people fairly in one go.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[13px]" data-testid={`rota-${g.name}`}>
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className="w-40 px-4 py-2 text-left font-medium">Position</th>
                        {dates.map((d) => (
                          <th key={d} className="px-2 py-2 text-left font-medium">
                            {formatDate(d, "week")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos) => (
                        <tr key={pos} className="border-t border-line">
                          <td className="px-4 py-2 font-medium">{pos}</td>
                          {dates.map((d) => {
                            const s = gs.find((x) => x.date === d && x.position === pos);
                            if (!s)
                              return (
                                <td key={d} className="px-2 py-1.5">
                                  <span className="text-faint">—</span>
                                </td>
                              );
                            return (
                              <td key={d} className="px-2 py-1.5">
                                <div className={cn("group flex items-center gap-1 rounded-lg border px-1.5 py-1", TONE[s.status])}>
                                  <select
                                    aria-label={`${pos} on ${formatDate(d, "short")}`}
                                    value={s.memberId ?? ""}
                                    onChange={(e) => assign.run({ id: s.id, memberId: e.target.value || null })}
                                    className="min-w-0 flex-1 truncate bg-transparent text-[13px] outline-none"
                                  >
                                    <option value="">Open</option>
                                    {g.members.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name}
                                      </option>
                                    ))}
                                  </select>
                                  {s.status === "confirmed" && <span className="text-[10px] font-semibold">✓</span>}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${pos} on ${formatDate(d, "short")}`}
                                    onClick={() => remove.run({ id: s.id })}
                                    className="hidden rounded p-0.5 text-faint hover:text-fg group-hover:block"
                                  >
                                    <X className="size-3" />
                                  </button>
                                </div>
                                {s.status === "declined" && <div className="mt-0.5 truncate text-[11px] text-bad">Can&apos;t make it{s.declineReason ? `: ${s.declineReason}` : ""}</div>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="border-t border-line">
                        <td className="px-4 py-1.5 text-xs text-faint">Add a position</td>
                        {dates.map((d) => (
                          <td key={d} className="px-2 py-1.5">
                            <button type="button" onClick={() => setAdding({ groupId: g.id, date: d })} className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-accent">
                              <Plus className="inline size-3" /> Add
                            </button>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })
      )}
      <FillDialog groupId={filling} onClose={() => setFilling(null)} groups={groups} dates={dates} slots={slots} />
      <AddDialog target={adding} onClose={() => setAdding(null)} groups={groups} />
    </>
  );
}

function FillDialog({ groupId, onClose, groups, dates, slots }: { groupId: string | null; onClose: () => void; groups: Group[]; dates: string[]; slots: RotaSlot[] }) {
  const router = useRouter();
  const [g, setG] = useState(groupId ?? "");
  const [picked, setPicked] = useState<string[]>(dates);
  const known = useMemo(() => [...new Set(slots.filter((s) => s.groupId === (groupId ?? g)).map((s) => s.position))], [slots, groupId, g]);
  const [positions, setPositions] = useState("");
  const [notify, setNotify] = useState(true);
  const act = useAction(fillAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const grp = groups.find((x) => x.id === (g || groupId));
  return (
    <Dialog open={!!groupId} onOpenChange={(o) => !o && onClose()}>
      {groupId !== null && (
        <DialogContent
          title="Fill the rota"
          description="Each position goes to the member who has served least recently. Nobody serves twice at one service; slots already filled stay as they are."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                loading={act.pending}
                onClick={() =>
                  act.run({
                    groupId: g || groupId,
                    dates: picked,
                    serviceLabel: "Sunday service",
                    positions: (positions || known.join(", ")).split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
                    notify,
                  })
                }
              >
                <Sparkles /> Fill
              </Button>
            </>
          }
        >
          <Field label="Department" htmlFor="fl-g">
            <Select id="fl-g" value={g || groupId} onChange={(e) => setG(e.target.value)}>
              {groups.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.members.length} members)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Positions" htmlFor="fl-p" error={act.fieldErrors.positions} hint="Separate with commas, e.g. Main door, Gallery, Children's wing.">
            <Input id="fl-p" value={positions} onChange={(e) => setPositions(e.target.value)} placeholder={known.join(", ") || "Main door, Gallery, Car park"} />
          </Field>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Sundays</legend>
            {dates.map((d) => (
              <Checkbox key={d} label={formatDate(d, "week")} checked={picked.includes(d)} onChange={() => setPicked((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d]))} />
            ))}
          </fieldset>
          <Checkbox label="Tell each volunteer (email, or SMS if no email)" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          {grp && grp.members.length === 0 && <p className="text-xs text-bad">This department has no members yet.</p>}
        </DialogContent>
      )}
    </Dialog>
  );
}

function AddDialog({ target, onClose, groups }: { target: { groupId: string; date: string } | null; onClose: () => void; groups: Group[] }) {
  const router = useRouter();
  const act = useAction(addSlotAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const g = groups.find((x) => x.id === target?.groupId);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <DialogContent
          title={`Add to ${g?.name}`}
          description={formatDate(target.date, "long")}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="add-slot" variant="primary" loading={act.pending}>
                Add
              </Button>
            </>
          }
        >
          <form
            id="add-slot"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act.run({ groupId: target.groupId, date: target.date, serviceLabel: "Sunday service", position: String(f.get("position")), memberId: String(f.get("memberId") ?? "") });
            }}
          >
            <Field label="Position" htmlFor="as-pos" error={act.fieldErrors.position}>
              <Input id="as-pos" name="position" placeholder="e.g. Main door" />
            </Field>
            <Field label="Who" htmlFor="as-mem" optional>
              <Select id="as-mem" name="memberId" defaultValue="">
                <option value="">Leave open</option>
                {g?.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
