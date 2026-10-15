"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { useAction, formToObject } from "@/components/ui/use-action";
import { NG_STATES } from "@/lib/ng";
import { signUpAction } from "../actions";

export function SignUpForm() {
  const router = useRouter();
  const { run, pending, fieldErrors: fe } = useAction(signUpAction, { onSuccess: (d) => router.replace(d.next) });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(formToObject(e.currentTarget) as Parameters<typeof signUpAction>[0]);
      }}
    >
      <Field label="Church name" htmlFor="churchName" error={fe.churchName}>
        <Input
          id="churchName"
          name="churchName"
          required
          placeholder="e.g. Grace Assembly Abuja"
          aria-invalid={!!fe.churchName}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label="Denomination" htmlFor="denomination" optional>
          <Input id="denomination" name="denomination" placeholder="e.g. Pentecostal" />
        </Field>
        <Field label="State" htmlFor="state" optional>
          <Select id="state" name="state" defaultValue="">
            <option value="">Choose a state</option>
            {NG_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Your full name" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" required autoComplete="name" aria-invalid={!!fe.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label="Email" htmlFor="email" error={fe.email}>
          <Input id="email" name="email" type="email" required autoComplete="email" aria-invalid={!!fe.email} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={fe.phone} optional>
          <Input
            id="phone"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0803 123 4567"
            aria-invalid={!!fe.phone}
          />
        </Field>
      </div>
      <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={10}
          aria-invalid={!!fe.password}
        />
      </Field>
      <Checkbox
        name="consent"
        label={
          <span className="text-muted">
            I agree to the terms of service and the data processing agreement. My church is the data controller for its
            members' data.
          </span>
        }
      />
      {fe.consent && <p className="-mt-2 text-xs text-bad">{fe.consent}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Create church account
      </Button>
    </form>
  );
}
