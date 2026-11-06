"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { TITLES } from "@/lib/ng";
import { saveChildAction } from "./actions";

export const CLASS_NAMES = ["Crèche", "Nursery", "Primary", "Juniors", "Teens"];
const RELATIONSHIPS = [
  "Mother",
  "Father",
  "Guardian",
  "Grandmother",
  "Grandfather",
  "Aunt",
  "Uncle",
  "Sister",
  "Brother",
  "Nanny",
  "Driver",
];

export type GuardianValues = {
  key: string;
  id?: string;
  title?: string | null;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  relationship: string;
  isPrimary: boolean;
  canPickUp: boolean;
  notify: boolean;
};
export type ChildValues = {
  branchId?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  gender?: string;
  dob?: string;
  classGroup?: string | null;
  allergies?: string | null;
  medical?: string | null;
  specialNeeds?: string | null;
  notes?: string | null;
  photoConsent?: boolean;
  guardians?: Omit<GuardianValues, "key">[];
};

let n = 0;
const blank = (primary = false): GuardianValues => ({
  key: `g${++n}`,
  firstName: "",
  lastName: "",
  relationship: primary ? "Mother" : "Father",
  isPrimary: primary,
  canPickUp: true,
  notify: true,
});

export function ChildDrawer({
  open,
  onOpenChange,
  id,
  initial,
  branches,
  canMedical,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  id?: string;
  initial?: ChildValues;
  branches: { id: string; name: string }[];
  canMedical: boolean;
}) {
  const router = useRouter();
  const [gs, setGs] = useState<GuardianValues[]>(() =>
    initial?.guardians?.length ? initial.guardians.map((g) => ({ ...g, key: `g${++n}` })) : [blank(true)],
  );
  const save = useAction(saveChildAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      if (!id) router.push(`/children/${d.id}`);
    },
  });
  const v = initial ?? {};
  const f = save.fieldErrors;
  const set = (key: string, patch: Partial<GuardianValues>) =>
    setGs((list) =>
      list.map((g) => (g.key === key ? { ...g, ...patch } : patch.isPrimary ? { ...g, isPrimary: false } : g)),
    );
  const noEmail = !gs.some((g) => g.email && g.notify);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          side
          title={id ? "Edit child" : "Register a child"}
          description={id ? undefined : "Parents listed here get an email each time the child is checked in or out."}
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="child-form" loading={save.pending}>
                {id ? "Save changes" : "Register child"}
              </Button>
            </>
          }
        >
          <form
            id="child-form"
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const get = (k: string) => (fd.get(k) as string | null) ?? undefined;
              save.run({
                id,
                values: {
                  branchId: get("branchId"),
                  firstName: get("firstName"),
                  middleName: get("middleName"),
                  lastName: get("lastName"),
                  gender: get("gender"),
                  dob: get("dob"),
                  classGroup: get("classGroup"),
                  allergies: get("allergies"),
                  medical: get("medical"),
                  specialNeeds: get("specialNeeds"),
                  notes: get("notes"),
                  photoConsent: fd.get("photoConsent") === "on",
                  guardians: gs.map((g) => ({
                    id: g.id,
                    title: g.title ?? undefined,
                    firstName: g.firstName,
                    lastName: g.lastName,
                    phone: g.phone ?? undefined,
                    email: g.email ?? undefined,
                    relationship: g.relationship,
                    isPrimary: g.isPrimary,
                    canPickUp: g.canPickUp,
                    notify: g.notify,
                  })),
                },
              });
            }}
          >
            <fieldset className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <legend className="col-span-full mb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
                Child
              </legend>
              <Field label="First name" htmlFor="c-first" error={f.firstName}>
                <Input id="c-first" name="firstName" required defaultValue={v.firstName} autoComplete="off" />
              </Field>
              <Field label="Surname" htmlFor="c-last" error={f.lastName}>
                <Input id="c-last" name="lastName" required defaultValue={v.lastName} autoComplete="off" />
              </Field>
              <Field label="Middle name" htmlFor="c-mid" optional>
                <Input id="c-mid" name="middleName" defaultValue={v.middleName ?? ""} autoComplete="off" />
              </Field>
              <Field label="Gender" htmlFor="c-gender" error={f.gender}>
                <Select id="c-gender" name="gender" required defaultValue={v.gender ?? ""}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="female">Girl</option>
                  <option value="male">Boy</option>
                </Select>
              </Field>
              <Field label="Date of birth" htmlFor="c-dob" error={f.dob}>
                <Input
                  id="c-dob"
                  name="dob"
                  type="date"
                  required
                  defaultValue={v.dob}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <Field label="Class" htmlFor="c-class" hint="Leave on automatic to place by age">
                <Select id="c-class" name="classGroup" defaultValue={v.classGroup ?? ""}>
                  <option value="">Automatic (by age)</option>
                  {CLASS_NAMES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              {branches.length > 1 && (
                <Field label="Branch" htmlFor="c-branch">
                  <Select id="c-branch" name="branchId" defaultValue={v.branchId ?? branches[0]?.id}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {branches.length <= 1 && <input type="hidden" name="branchId" value={v.branchId ?? branches[0]?.id} />}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
                Parents and guardians
              </legend>
              {f.guardians && <Note tone="bad">{f.guardians}</Note>}
              {gs.map((g, i) => (
                <div key={g.key} className="flex flex-col gap-3 rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[13px] font-medium">
                      <input
                        type="radio"
                        name="primaryGuardian"
                        className="accent-[var(--accent)]"
                        checked={g.isPrimary}
                        onChange={() => set(g.key, { isPrimary: true })}
                      />
                      Main contact
                    </label>
                    {gs.length > 1 && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="ml-auto"
                        aria-label={`Remove guardian ${i + 1}`}
                        onClick={() => setGs((l) => l.filter((x) => x.key !== g.key))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-[90px_1fr_1fr] gap-2 max-sm:grid-cols-2">
                    <Select
                      aria-label="Title"
                      value={g.title ?? ""}
                      onChange={(e) => set(g.key, { title: e.target.value || null })}
                    >
                      <option value="">Title</option>
                      {TITLES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                    <Input
                      aria-label={`Guardian ${i + 1} first name`}
                      placeholder="First name"
                      required
                      value={g.firstName}
                      onChange={(e) => set(g.key, { firstName: e.target.value })}
                    />
                    <Input
                      aria-label={`Guardian ${i + 1} surname`}
                      placeholder="Surname"
                      required
                      value={g.lastName}
                      onChange={(e) => set(g.key, { lastName: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                    <Input
                      aria-label={`Guardian ${i + 1} relationship`}
                      list="relationships"
                      placeholder="Relationship"
                      required
                      value={g.relationship}
                      onChange={(e) => set(g.key, { relationship: e.target.value })}
                    />
                    <Input
                      aria-label={`Guardian ${i + 1} phone`}
                      placeholder="Phone"
                      inputMode="tel"
                      value={g.phone ?? ""}
                      onChange={(e) => set(g.key, { phone: e.target.value })}
                    />
                    <Input
                      aria-label={`Guardian ${i + 1} email`}
                      placeholder="Email (for alerts)"
                      type="email"
                      value={g.email ?? ""}
                      onChange={(e) => set(g.key, { email: e.target.value })}
                    />
                  </div>
                  {(f[`guardians.${i}.phone`] || f[`guardians.${i}.email`] || f[`guardians.${i}.relationship`]) && (
                    <p className="text-xs text-bad">
                      {f[`guardians.${i}.phone`] ?? f[`guardians.${i}.email`] ?? f[`guardians.${i}.relationship`]}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <Checkbox
                      label="Can pick the child up"
                      checked={g.canPickUp}
                      onChange={(e) => set(g.key, { canPickUp: e.target.checked })}
                    />
                    <Checkbox
                      label="Email check-in and check-out alerts"
                      checked={g.notify}
                      onChange={(e) => set(g.key, { notify: e.target.checked })}
                    />
                  </div>
                </div>
              ))}
              <datalist id="relationships">
                {RELATIONSHIPS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              {gs.length < 6 && (
                <Button type="button" className="self-start" onClick={() => setGs((l) => [...l, blank(false)])}>
                  <Plus /> Add another guardian
                </Button>
              )}
              {noEmail && (
                <Note tone="warn" icon={<Mail />}>
                  No guardian has an email address with alerts on, so no one will be told when this child is checked in
                  or out.
                </Note>
              )}
            </fieldset>

            <fieldset className="grid grid-cols-1 gap-3">
              <legend className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
                <HeartPulse className="size-3.5" /> Care and safety
              </legend>
              {canMedical ? (
                <>
                  <Field label="Allergies" htmlFor="c-all" optional hint="Shown as an alert at the check-in desk">
                    <Input
                      id="c-all"
                      name="allergies"
                      defaultValue={v.allergies ?? ""}
                      placeholder="e.g. Peanuts, penicillin"
                    />
                  </Field>
                  <Field label="Medical conditions or medication" htmlFor="c-med" optional>
                    <Textarea id="c-med" name="medical" rows={2} defaultValue={v.medical ?? ""} />
                  </Field>
                  <Field label="Special needs" htmlFor="c-sn" optional>
                    <Textarea id="c-sn" name="specialNeeds" rows={2} defaultValue={v.specialNeeds ?? ""} />
                  </Field>
                </>
              ) : (
                <p className="text-xs text-faint">Your role can&apos;t see or change medical notes.</p>
              )}
              <Field label="Notes for teachers" htmlFor="c-notes" optional>
                <Textarea id="c-notes" name="notes" rows={2} defaultValue={v.notes ?? ""} />
              </Field>
              <Checkbox
                name="photoConsent"
                defaultChecked={v.photoConsent}
                label="Parents agree to photos of this child in church media"
              />
            </fieldset>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
