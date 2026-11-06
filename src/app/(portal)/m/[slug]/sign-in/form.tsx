"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { requestCodeAction, verifyCodeAction } from "../actions";

export function SignInForm({ slug }: { slug: string }) {
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const ask = async () => {
    setPending(true);
    setError(null);
    const r = await requestCodeAction(slug, { identifier });
    setPending(false);
    if (r.ok) {
      setSent(r.data.sentTo);
      setErrors({});
    } else {
      setError(r.error);
      setErrors(r.fieldErrors ?? {});
    }
  };
  return (
    <Card>
      <CardBody>
        {!sent ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pending) ask();
            }}
          >
            {error && <Note tone="bad">{error}</Note>}
            <Field label="Phone number or email" htmlFor="pt-id" error={errors.identifier}>
              <Input id="pt-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" placeholder="0803 123 4567" autoFocus />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending}>
              Send me a code
            </Button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pending) return;
              setPending(true);
              setError(null);
              const code = String(new FormData(e.currentTarget).get("code") ?? "");
              const r = await verifyCodeAction(slug, { identifier, code });
              setPending(false);
              if (r && !r.ok) {
                setError(r.error);
                setErrors(r.fieldErrors ?? {});
              }
            }}
          >
            <Note>If {sent} is on your record, a 6-digit code is on its way. It can take a minute.</Note>
            {error && <Note tone="bad">{error}</Note>}
            <Field label="Code" htmlFor="pt-code" error={errors.code}>
              <Input id="pt-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-mono text-lg tracking-[0.4em]" autoFocus />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending}>
              Sign in
            </Button>
            <div className="flex justify-between text-xs">
              <button type="button" className="text-muted hover:text-fg" onClick={() => (setSent(null), setError(null))}>
                Use another number
              </button>
              <button type="button" className="text-accent" onClick={ask} disabled={pending}>
                Send a new code
              </button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
