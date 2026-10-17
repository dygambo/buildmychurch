"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { changeTemporaryPasswordAction } from "../actions";

export function ChangePasswordForm() {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction(changeTemporaryPasswordAction, { onSuccess: (d) => router.replace(d.next) });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run({ password: String(f.get("password") ?? ""), confirm: String(f.get("confirm") ?? "") });
      }}
    >
      <Field label="New password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters. A short sentence works well.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={fieldErrors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Save and continue
      </Button>
    </form>
  );
}
