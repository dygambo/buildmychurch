"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/utils";
import { MemberPicker } from "../members/member-picker";
import { saveCaseAction } from "./actions";

type Partner = { memberId: string | null; name: string; phone: string; email: string };
export type CaseInitial = {
  id: string;
  kind: "premarital" | "marital";
  branchId: string;
  a: Partner;
  b: Partner;
  weddingDate: string | null;
  weddingVenue: string | null;
  marriedSince: string | null;
  reason: string | null;
  plannedSessions: number;
  counsellorIds: string[];
};

const empty: Partner = { memberId: null, name: "", phone: "", email: "" };

function PartnerFields({ who, label, value, onChange, errors }: { who: "a" | "b"; label: string; value: Partner; onChange: (p: Partner) => void; errors: Record<string, string> }) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-line p-3">
      <legend className="px-1 text-[12.5px] font-medium text-muted">{label}</legend>
      {value.memberId ? (
        <div className="flex items-center justify-between text-[13px]">
          <span>
            <span className="font-medium">{value.name}</span> <span className="text-xs text-faint">member</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(empty)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <MemberPicker placeholder={`Find ${label.toLowerCase()} in the members list`} onPick={(m) => onChange({ memberId: m.id, name: m.name, phone: "", email: "" })} />
          <div className="text-center text-[11px] text-faint">or, if they aren&apos;t a member</div>
          <Field label="Full name" htmlFor={`${who}-name`} error={errors[`${who}Name`]}>
            <Input id={`${who}-name`} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <Field label="Phone" htmlFor={`${who}-phone`} optional error={errors[`${who}Phone`]}>
              <Input id={`${who}-phone`} inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor={`${who}-email`} optional error={errors[`${who}Email`]}>
              <Input id={`${who}-email`} type="email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
            </Field>
          </div>
        </>
      )}
    </fieldset>
  );
}

export function CaseDialog({
  open,
  onClose,
  team,
  branches,
  canOversee,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  team: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  canOversee: boolean;
  initial?: CaseInitial;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"premarital" | "marital">(initial?.kind ?? "premarital");
  const [a, setA] = useState<Partner>(initial?.a ?? empty);
  const [b, setB] = useState<Partner>(initial?.b ?? empty);
  const [counsellorIds, setCounsellorIds] = useState<string[]>(initial?.counsellorIds ?? []);
  const act = useAction(saveCaseAction, {
    onSuccess: (d) => {
      onClose();
      if (!initial) router.push(`/counselling/${d.id}`);
      else router.refresh();
    },
  });
  const fe = act.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent
          title={initial ? "Edit couple" : "New couple"}
          description="Personal details and the reason for counselling are encrypted. Only pastors and this couple's counsellors can see them."
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="case-form" variant="primary" loading={act.pending}>
                {initial ? "Save" : "Open record"}
              </Button>
            </>
          }
        >
          <form
            id="case-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const g = (k: string) => String(f.get(k) ?? "");
              act.run({
                id: initial?.id,
                kind,
                branchId: g("branchId") || initial?.branchId || null,
                aMemberId: a.memberId,
                aName: a.name,
                aPhone: a.memberId ? null : a.phone,
                aEmail: a.memberId ? null : a.email,
                bMemberId: b.memberId,
                bName: b.name,
                bPhone: b.memberId ? null : b.phone,
                bEmail: b.memberId ? null : b.email,
                weddingDate: g("weddingDate") || null,
                weddingVenue: g("weddingVenue") || null,
                marriedSince: g("marriedSince") || null,
                reason: g("reason") || null,
                plannedSessions: Number(g("plannedSessions") || 8),
                counsellorIds,
              });
            }}
          >
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind of counselling">
              {(
                [
                  ["premarital", "Pre-marital", "Preparing for their wedding"],
                  ["marital", "Marriage support", "Married couples who want help"],
                ] as const
              ).map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn("rounded-lg border px-3 py-2.5 text-left", kind === k ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
                >
                  <div className="text-[13px] font-medium">{label}</div>
                  <div className="text-xs text-muted">{hint}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
              <PartnerFields who="a" label={kind === "premarital" ? "First partner" : "Husband or wife"} value={a} onChange={setA} errors={fe} />
              <PartnerFields who="b" label={kind === "premarital" ? "Second partner" : "Their spouse"} value={b} onChange={setB} errors={fe} />
            </div>
            {kind === "premarital" ? (
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="Planned wedding date" htmlFor="c-wd" optional error={fe.weddingDate}>
                  <Input id="c-wd" name="weddingDate" type="date" defaultValue={initial?.weddingDate ?? ""} />
                </Field>
                <Field label="Wedding venue" htmlFor="c-wv" optional>
                  <Input id="c-wv" name="weddingVenue" defaultValue={initial?.weddingVenue ?? ""} placeholder="e.g. Main auditorium" />
                </Field>
              </div>
            ) : (
              <Field label="Married since" htmlFor="c-ms" optional>
                <Input id="c-ms" name="marriedSince" type="date" defaultValue={initial?.marriedSince ?? ""} />
              </Field>
            )}
            <Field label={kind === "premarital" ? "Notes from the first conversation" : "Why they asked for help"} htmlFor="c-reason" optional>
              <Textarea id="c-reason" name="reason" rows={3} defaultValue={initial?.reason ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Number of sessions planned" htmlFor="c-ps">
                <Input id="c-ps" name="plannedSessions" type="number" min={1} max={30} defaultValue={initial?.plannedSessions ?? (kind === "premarital" ? 8 : 6)} />
              </Field>
              {branches.length > 1 && (
                <Field label="Branch" htmlFor="c-br" optional hint="Defaults to the partner's branch">
                  <Select id="c-br" name="branchId" defaultValue={initial?.branchId ?? ""}>
                    <option value="">Their branch</option>
                    {branches.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {canOversee ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-[12.5px] font-medium text-muted">Counsellors (up to 3)</legend>
                {team.length === 0 ? (
                  <p className="text-xs text-faint">No one has a counselling role yet. Give someone the Marriage Counsellor role in Settings, Team.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 max-sm:grid-cols-1">
                    {team.map((t) => (
                      <Checkbox
                        key={t.id}
                        label={t.name}
                        checked={counsellorIds.includes(t.id)}
                        disabled={!counsellorIds.includes(t.id) && counsellorIds.length >= 3}
                        onChange={(e) => setCounsellorIds((l) => (e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id)))}
                      />
                    ))}
                  </div>
                )}
                {fe.counsellorIds && <p className="text-xs text-bad">{fe.counsellorIds}</p>}
              </fieldset>
            ) : (
              !initial && <p className="text-xs text-faint">You&apos;ll be this couple&apos;s counsellor. A pastor can add others.</p>
            )}
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
