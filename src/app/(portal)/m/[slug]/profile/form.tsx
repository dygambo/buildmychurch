"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { updateProfileAction } from "../actions";

type P = {
  phone: string | null;
  email: string | null;
  address: string | null;
  area: string | null;
  occupation: string | null;
  employer: string | null;
  dobDay: number | null;
  dobMonth: number | null;
  maritalStatus: string | null;
  consentMessaging: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ProfileForm({ slug, p }: { slug: string; p: P }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Card>
      <CardBody>
        <form
          className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending) return;
            setPending(true);
            setError(null);
            const f = new FormData(e.currentTarget);
            const g = (k: string) => String(f.get(k) ?? "");
            const r = await updateProfileAction(slug, {
              email: g("email"),
              address: g("address"),
              area: g("area"),
              occupation: g("occupation"),
              employer: g("employer"),
              dobDay: g("dobDay"),
              dobMonth: g("dobMonth"),
              maritalStatus: g("maritalStatus"),
              consentMessaging: f.get("consentMessaging") === "on",
            });
            setPending(false);
            if (r.ok) {
              setErrors({});
              toast.success("Your details are saved");
            } else {
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
            }
          }}
        >
          {error && <Note tone="bad" className="col-span-full">{error}</Note>}
          <Field label="Phone" htmlFor="pf-phone" hint="To change your phone number, ask the church office." className="col-span-full">
            <Input id="pf-phone" value={p.phone ?? "Not on record"} disabled />
          </Field>
          <Field label="Email" htmlFor="pf-email" error={errors.email} optional className="col-span-full">
            <Input id="pf-email" name="email" type="email" defaultValue={p.email ?? ""} autoComplete="email" />
          </Field>
          <Field label="Home address" htmlFor="pf-addr" optional className="col-span-full">
            <Textarea id="pf-addr" name="address" rows={2} defaultValue={p.address ?? ""} autoComplete="street-address" />
          </Field>
          <Field label="Area" htmlFor="pf-area" optional hint="e.g. Gwarinpa, Ikeja GRA">
            <Input id="pf-area" name="area" defaultValue={p.area ?? ""} />
          </Field>
          <Field label="Marital status" htmlFor="pf-ms" optional>
            <Select id="pf-ms" name="maritalStatus" defaultValue={p.maritalStatus ?? ""}>
              <option value="">Prefer not to say</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="widowed">Widowed</option>
              <option value="divorced">Divorced</option>
              <option value="separated">Separated</option>
            </Select>
          </Field>
          <Field label="Occupation" htmlFor="pf-occ" optional>
            <Input id="pf-occ" name="occupation" defaultValue={p.occupation ?? ""} />
          </Field>
          <Field label="Employer or business" htmlFor="pf-emp" optional>
            <Input id="pf-emp" name="employer" defaultValue={p.employer ?? ""} />
          </Field>
          <fieldset className="col-span-full grid grid-cols-2 gap-3">
            <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Birthday (so we can celebrate you)</legend>
            <Select aria-label="Birthday day" name="dobDay" defaultValue={p.dobDay ?? ""}>
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </Select>
            <Select aria-label="Birthday month" name="dobMonth" defaultValue={p.dobMonth ?? ""}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
            {errors.dobDay && <p className="col-span-full text-xs text-bad">{errors.dobDay}</p>}
          </fieldset>
          <Checkbox name="consentMessaging" defaultChecked={p.consentMessaging} label="Send me church news and reminders by SMS, email or WhatsApp" className="col-span-full" />
          <Button type="submit" variant="primary" loading={pending} className="col-span-full justify-center">
            Save my details
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
