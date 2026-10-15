"use client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction, formToObject } from "@/components/ui/use-action";
import { NG_STATES } from "@/lib/ng";
import { formatPhone } from "@/lib/phone";
import { updateOrgAction } from "./actions";

type Org = {
  name: string;
  denomination: string;
  state: string;
  lga: string;
  address: string;
  phone: string;
  email: string;
  smsSenderId: string;
  slug: string;
};

export function OrgForm({ org }: { org: Org }) {
  const { run, pending, fieldErrors: fe } = useAction(updateOrgAction);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(formToObject(e.currentTarget) as Org);
      }}
    >
      <Card>
        <CardHeader title="Church profile" />
        <CardBody className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field label="Church name" htmlFor="name" error={fe.name} className="col-span-full">
            <Input id="name" name="name" defaultValue={org.name} required />
          </Field>
          <Field label="Denomination" htmlFor="denomination" optional>
            <Input id="denomination" name="denomination" defaultValue={org.denomination} />
          </Field>
          <Field label="State" htmlFor="state" optional>
            <Select id="state" name="state" defaultValue={org.state}>
              <option value="">Choose a state</option>
              {NG_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Local government area" htmlFor="lga" optional>
            <Input id="lga" name="lga" defaultValue={org.lga} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fe.phone} optional>
            <Input id="phone" name="phone" defaultValue={formatPhone(org.phone)} inputMode="tel" />
          </Field>
          <Field label="Headquarters address" htmlFor="address" className="col-span-full" optional>
            <Input id="address" name="address" defaultValue={org.address} />
          </Field>
          <Field label="Church email" htmlFor="email" error={fe.email} optional>
            <Input id="email" name="email" type="email" defaultValue={org.email} />
          </Field>
          <Field
            label="SMS sender ID"
            htmlFor="smsSenderId"
            error={fe.smsSenderId}
            hint="Up to 11 letters, registered with your SMS provider."
            optional
          >
            <Input id="smsSenderId" name="smsSenderId" defaultValue={org.smsSenderId} maxLength={11} />
          </Field>
          <Field
            label="Public link name"
            htmlFor="slug"
            hint="Used in your giving and visitor-card links."
            className="col-span-full"
          >
            <Input id="slug" value={`buildmychurch.com/c/${org.slug}`} readOnly className="font-mono text-faint" />
          </Field>
          <div className="col-span-full flex justify-end">
            <Button type="submit" variant="primary" loading={pending}>
              Save changes
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
