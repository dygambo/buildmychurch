"use client";
import { useState, useTransition } from "react";
import { HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { visitorCardAction } from "../../actions";

export function VisitorCard({ token, church }: { token: string; church: string }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ firstName: string; returning: boolean } | null>(null);
  if (done)
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-8 text-center" role="status">
          <HeartHandshake className="size-12 text-accent" />
          <p className="text-lg font-semibold">Thank you, {done.firstName}!</p>
          <p className="text-[13px] text-muted">
            {done.returning
              ? "Welcome back. We've let the team know you're here."
              : `Someone from ${church} will reach out in the next few days.`}
          </p>
        </CardBody>
      </Card>
    );
  return (
    <Card>
      <CardBody>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const values = Object.fromEntries(fd.entries()) as Record<string, unknown>;
            for (const k of ["wantsVisit", "consentMessaging"]) values[k] = fd.get(k) === "on";
            start(async () => {
              const r = await visitorCardAction({ token, values });
              if (r.ok) setDone(r.data);
              else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            });
          }}
        >
          {error && (
            <Note tone="bad" className="col-span-full">
              {error}
            </Note>
          )}
          <Field label="First name" htmlFor="v-first" error={errors.firstName}>
            <Input id="v-first" name="firstName" required autoComplete="given-name" />
          </Field>
          <Field label="Surname" htmlFor="v-last" error={errors.lastName}>
            <Input id="v-last" name="lastName" required autoComplete="family-name" />
          </Field>
          <Field label="Phone number" htmlFor="v-phone" error={errors.phone} className="col-span-full">
            <Input id="v-phone" name="phone" required inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" />
          </Field>
          <Field label="Email" htmlFor="v-email" error={errors.email} optional className="col-span-full">
            <Input id="v-email" name="email" type="email" autoComplete="email" />
          </Field>
          <Field label="Gender" htmlFor="v-gender" error={errors.gender}>
            <Select id="v-gender" name="gender" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </Select>
          </Field>
          <Field label="Age" htmlFor="v-age" optional>
            <Select id="v-age" name="ageRange" defaultValue="">
              <option value="">Prefer not to say</option>
              <option value="under18">Under 18</option>
              <option value="18-25">18–25</option>
              <option value="26-35">26–35</option>
              <option value="36-50">36–50</option>
              <option value="51+">51+</option>
            </Select>
          </Field>
          <Field
            label="Where do you live?"
            htmlFor="v-area"
            optional
            hint="Area only, e.g. Ikeja"
            className="col-span-full"
          >
            <Input id="v-area" name="area" />
          </Field>
          <Field label="How did you hear about us?" htmlFor="v-how" optional className="col-span-full">
            <Select id="v-how" name="howHeard" defaultValue="">
              <option value="">—</option>
              <option>Invited by a friend or family</option>
              <option>Social media</option>
              <option>Passing by</option>
              <option>Online search</option>
              <option>Event or crusade</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="How can we pray for you?" htmlFor="v-prayer" optional className="col-span-full">
            <Textarea id="v-prayer" name="prayerRequest" rows={3} />
          </Field>
          <div className="col-span-full flex flex-col gap-2.5">
            <Checkbox name="wantsVisit" label="I'd like someone from the church to visit me" />
            <Checkbox name="consentMessaging" label={`${church} may send me messages by SMS, email or WhatsApp`} />
          </div>
          <Button type="submit" variant="primary" size="lg" className="col-span-full justify-center" loading={pending}>
            Send
          </Button>
          <p className="col-span-full text-center text-xs text-faint">
            Your details are kept private and used only by {church}, under the Nigeria Data Protection Act.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
