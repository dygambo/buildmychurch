"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { resetPasswordAction } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction(resetPasswordAction, { onSuccess: (d) => router.replace(d.next) });
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run({ token, password: String(new FormData(e.currentTarget).get("password") ?? "") });
      }}
    >
      <Field label="New password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          autoFocus
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Save password and sign in
      </Button>
    </form>
  );
}
