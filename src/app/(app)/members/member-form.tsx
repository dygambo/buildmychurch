"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/card";
import { useAction, formToObject } from "@/components/ui/use-action";
import { TITLES } from "@/lib/ng";
import { saveMemberAction } from "./actions";
import { MONTHS, STAGE_LABEL, STATUS_LABEL } from "./labels";

export type MemberFormValues = Partial<{
  branchId: string;
  title: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string;
  dobDay: number | null;
  dobMonth: number | null;
  dobYear: number | null;
  maritalStatus: string | null;
  anniversary: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  area: string | null;
  occupation: string | null;
  employer: string | null;
  bloodGroup: string | null;
  genotype: string | null;
  stage: string;
  status: string;
  joinDate: string | null;
  baptism: string;
  foundationSchoolAt: string | null;
  howHeard: string | null;
  consentMessaging: boolean;
  consentHealth: boolean;
  consentPhoto: boolean;
  dnd: boolean;
}>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <legend className="col-span-full mb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** Add or edit a member in a side drawer. */
export function MemberDrawer({
  open,
  onOpenChange,
  id,
  initial,
  branches,
  canSensitive,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  id?: string;
  initial?: MemberFormValues;
  branches: { id: string; name: string }[];
  canSensitive: boolean;
}) {
  const router = useRouter();
  const [dup, setDup] = useState<string | null>(null);
  const [health, setHealth] = useState(!!initial?.consentHealth);
  const save = useAction(saveMemberAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      setDup(null);
      if (!id) router.push(`/members/${d.id}`);
    },
    onError: (e) => setDup(/already has this phone/.test(e) ? e : null),
  });
  const v = initial ?? {};
  const f = save.fieldErrors;
  const submit = (form: HTMLFormElement, allowDuplicate = false) =>
    save.run({ id, values: formToObject(form), allowDuplicate });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          side
          title={id ? "Edit member" : "Add a member"}
          description={id ? undefined : "Only names and gender are required. You can fill in the rest later."}
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="member-form" loading={save.pending}>
                {id ? "Save changes" : "Add member"}
              </Button>
            </>
          }
        >
          <form
            id="member-form"
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              submit(e.currentTarget);
            }}
          >
            {dup && !id && (
              <Note tone="warn">
                {dup}{" "}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => submit(document.getElementById("member-form") as HTMLFormElement, true)}
                >
                  Add anyway
                </button>
              </Note>
            )}
            <Section title="Name">
              <Field label="Title" htmlFor="m-title" optional>
                <Select id="m-title" name="title" defaultValue={v.title ?? ""}>
                  <option value="">—</option>
                  {TITLES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Gender" htmlFor="m-gender" error={f.gender}>
                <Select id="m-gender" name="gender" defaultValue={v.gender ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </Select>
              </Field>
              <Field label="First name" htmlFor="m-first" error={f.firstName}>
                <Input id="m-first" name="firstName" defaultValue={v.firstName} required autoComplete="off" />
              </Field>
              <Field label="Surname" htmlFor="m-last" error={f.lastName}>
                <Input id="m-last" name="lastName" defaultValue={v.lastName} required autoComplete="off" />
              </Field>
              <Field label="Middle name" htmlFor="m-middle" optional className="col-span-full">
                <Input id="m-middle" name="middleName" defaultValue={v.middleName ?? ""} autoComplete="off" />
              </Field>
            </Section>

            <Section title="Contact">
              <Field label="Phone" htmlFor="m-phone" error={f.phone} hint="Any format: 0803…, +234…">
                <Input id="m-phone" name="phone" inputMode="tel" defaultValue={v.phone ?? ""} />
              </Field>
              {canSensitive ? (
                <>
                  <Field label="Email" htmlFor="m-email" error={f.email} optional>
                    <Input id="m-email" name="email" type="email" defaultValue={v.email ?? ""} />
                  </Field>
                  <Field label="Home address" htmlFor="m-address" optional className="col-span-full">
                    <Textarea id="m-address" name="address" rows={2} defaultValue={v.address ?? ""} />
                  </Field>
                </>
              ) : (
                <p className="self-end pb-2 text-xs text-faint">Your role can't see or change email and address.</p>
              )}
              <Field label="Area" htmlFor="m-area" optional hint="Used to suggest a home cell, e.g. Gwarinpa">
                <Input id="m-area" name="area" defaultValue={v.area ?? ""} />
              </Field>
              <Field label="Occupation" htmlFor="m-occ" optional>
                <Input id="m-occ" name="occupation" defaultValue={v.occupation ?? ""} />
              </Field>
            </Section>

            <Section title="Personal">
              <Field
                label="Birthday"
                htmlFor="m-dobday"
                error={f.dobDay ?? f.dobMonth ?? f.dobYear}
                optional
                className="col-span-full"
              >
                <div className="grid grid-cols-[80px_1fr_100px] gap-2">
                  <Input
                    id="m-dobday"
                    name="dobDay"
                    inputMode="numeric"
                    placeholder="Day"
                    aria-label="Birthday day"
                    defaultValue={v.dobDay ?? ""}
                  />
                  <Select name="dobMonth" aria-label="Birthday month" defaultValue={v.dobMonth ?? ""}>
                    <option value="">Month</option>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </Select>
                  <Input
                    name="dobYear"
                    inputMode="numeric"
                    placeholder="Year"
                    aria-label="Birth year (optional)"
                    defaultValue={v.dobYear ?? ""}
                  />
                </div>
              </Field>
              <Field label="Marital status" htmlFor="m-marital" optional>
                <Select id="m-marital" name="maritalStatus" defaultValue={v.maritalStatus ?? ""}>
                  <option value="">—</option>
                  <option value="single">Single</option>
                  <option value="married">Married</option>
                  <option value="widowed">Widowed</option>
                  <option value="separated">Separated</option>
                  <option value="divorced">Divorced</option>
                </Select>
              </Field>
              <Field label="Wedding anniversary" htmlFor="m-ann" optional error={f.anniversary}>
                <Input id="m-ann" name="anniversary" type="date" defaultValue={v.anniversary ?? ""} />
              </Field>
            </Section>

            <Section title="Church life">
              <Field label="Branch" htmlFor="m-branch" error={f.branchId}>
                <Select id="m-branch" name="branchId" defaultValue={v.branchId ?? branches[0]?.id} required>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Stage" htmlFor="m-stage">
                <Select id="m-stage" name="stage" defaultValue={v.stage ?? "member"}>
                  {Object.entries(STAGE_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Joined on" htmlFor="m-join" optional hint="Defaults to today">
                <Input id="m-join" name="joinDate" type="date" defaultValue={v.joinDate ?? ""} />
              </Field>
              <Field label="Baptism" htmlFor="m-bapt">
                <Select id="m-bapt" name="baptism" defaultValue={v.baptism ?? "none"}>
                  <option value="none">Not yet</option>
                  <option value="water">Water baptism</option>
                  <option value="spirit">Holy Spirit baptism</option>
                  <option value="both">Both</option>
                </Select>
              </Field>
              <Field label="Foundation school completed" htmlFor="m-fs" optional>
                <Input id="m-fs" name="foundationSchoolAt" type="date" defaultValue={v.foundationSchoolAt ?? ""} />
              </Field>
              {id && (
                <Field label="Status" htmlFor="m-status">
                  <Select id="m-status" name="status" defaultValue={v.status ?? "active"}>
                    {Object.entries(STATUS_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="How they heard about us" htmlFor="m-how" optional className="col-span-full">
                <Input id="m-how" name="howHeard" defaultValue={v.howHeard ?? ""} />
              </Field>
            </Section>

            <Section title="Consent">
              <div className="col-span-full flex flex-col gap-2.5 rounded-xl border border-line bg-surface-2 p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <ShieldCheck className="size-3.5" /> Ask the person and record what they agree to. Changes are logged.
                </p>
                <Checkbox
                  name="consentMessaging"
                  defaultChecked={v.consentMessaging}
                  label="Agrees to receive SMS, email and WhatsApp messages"
                />
                <Checkbox
                  name="dnd"
                  defaultChecked={v.dnd}
                  label="Do not disturb: never send this person bulk messages"
                />
                <Checkbox
                  name="consentPhoto"
                  defaultChecked={v.consentPhoto}
                  label="Agrees to photos being used in church media"
                />
                {canSensitive && (
                  <Checkbox
                    name="consentHealth"
                    checked={health}
                    onChange={(e) => setHealth(e.target.checked)}
                    label="Agrees to the church keeping health details (for emergencies)"
                  />
                )}
              </div>
              {canSensitive && health && (
                <>
                  <Field label="Blood group" htmlFor="m-blood" optional>
                    <Select id="m-blood" name="bloodGroup" defaultValue={v.bloodGroup ?? ""}>
                      <option value="">—</option>
                      {["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Genotype" htmlFor="m-geno" optional>
                    <Select id="m-geno" name="genotype" defaultValue={v.genotype ?? ""}>
                      <option value="">—</option>
                      {["AA", "AS", "AC", "SS", "SC"].map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
            </Section>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
