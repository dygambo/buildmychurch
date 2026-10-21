"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Note } from "@/components/ui/card";
import { useAction } from "@/components/ui/use-action";
import { forgotPasswordAction } from "../actions";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const { run, pending, fieldErrors } = useAction(forgotPasswordAction, { onSuccess: () => setSent(true) });
  if (sent)
    return (
      <Note tone="good">
        If that email has an account, a reset link is on its way. It works for one hour. Check your spam folder if you
        don't see it.
      </Note>
    );
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run({ email: String(new FormData(e.currentTarget).get("email") ?? "") });
      }}
    >
      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Send reset link
      </Button>
    </form>
  );
}
