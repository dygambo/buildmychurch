"use client";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { counsellingRequestAction } from "../../actions";

export function CounsellingRequestForm({ token }: { token: string }) {
  const [kind, setKind] = useState<"premarital" | "marital">("premarital");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (done)
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 className="size-10 text-good" />
          <h2 className="text-lg font-semibold">We&apos;ve received your request</h2>
          <p className="text-[13px] text-muted">A pastor will contact you to arrange your first session. Your reference is {done}.</p>
        </CardBody>
      </Card>
    );
  return (
    <Card>
      <CardBody>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending) return;
            setPending(true);
            setError(null);
            const f = new FormData(e.currentTarget);
            const g = (k: string) => String(f.get(k) ?? "");
            const r = await counsellingRequestAction({
              token,
              values: { kind, aName: g("aName"), aPhone: g("aPhone"), aEmail: g("aEmail"), bName: g("bName"), bPhone: g("bPhone"), bEmail: g("bEmail"), weddingDate: g("weddingDate"), marriedSince: g("marriedSince"), reason: g("reason") },
            });
            setPending(false);
            if (r.ok) setDone(r.data.refNo);
            else {
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
            }
          }}
        >
          {error && <Note tone="bad">{error}</Note>}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What kind of counselling">
            {(
              [
                ["premarital", "We're getting married", "Pre-marital counselling"],
                ["marital", "We're married", "Support for our marriage"],
              ] as const
            ).map(([k, label, hint]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("rounded-lg border px-3 py-2.5 text-left", kind === k ? "border-accent bg-accent-soft" : "border-line-strong")}
              >
                <div className="text-[13px] font-medium">{label}</div>
                <div className="text-xs text-muted">{hint}</div>
              </button>
            ))}
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[13px] font-semibold">You</legend>
            <Field label="Your full name" htmlFor="mc-an" error={errors.aName}>
              <Input id="mc-an" name="aName" autoComplete="name" required />
            </Field>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Your phone" htmlFor="mc-ap" error={errors.aPhone}>
                <Input id="mc-ap" name="aPhone" inputMode="tel" autoComplete="tel" required />
              </Field>
              <Field label="Your email" htmlFor="mc-ae" optional error={errors.aEmail}>
                <Input id="mc-ae" name="aEmail" type="email" autoComplete="email" />
              </Field>
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[13px] font-semibold">{kind === "premarital" ? "Your fiancé(e)" : "Your spouse"}</legend>
            <Field label="Their full name" htmlFor="mc-bn" error={errors.bName}>
              <Input id="mc-bn" name="bName" required />
            </Field>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Their phone" htmlFor="mc-bp" optional error={errors.bPhone}>
                <Input id="mc-bp" name="bPhone" inputMode="tel" />
              </Field>
              <Field label="Their email" htmlFor="mc-be" optional error={errors.bEmail}>
                <Input id="mc-be" name="bEmail" type="email" />
              </Field>
            </div>
          </fieldset>
          {kind === "premarital" ? (
            <Field label="Planned wedding date" htmlFor="mc-wd" optional error={errors.weddingDate}>
              <Input id="mc-wd" name="weddingDate" type="date" />
            </Field>
          ) : (
            <Field label="When did you marry?" htmlFor="mc-ms" optional>
              <Input id="mc-ms" name="marriedSince" type="date" />
            </Field>
          )}
          <Field label={kind === "premarital" ? "Anything you'd like us to know" : "What would you like help with?"} htmlFor="mc-r" optional>
            <Textarea id="mc-r" name="reason" rows={4} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending}>
            Send request
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
