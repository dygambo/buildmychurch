"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { acceptInviteAction } from "../../actions";

export function InviteForm({ token, name, hasAccount }: { token: string; name: string; hasAccount: boolean }) {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction(acceptInviteAction, { onSuccess: (d) => router.replace(d.next) });
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run({ token, password: String(f.get("password") ?? ""), name: String(f.get("name") ?? "") || undefined });
      }}
    >
      {!hasAccount && (
        <Field label="Your full name" htmlFor="name">
          <Input id="name" name="name" defaultValue={name} required />
        </Field>
      )}
      <Field
        label={hasAccount ? "Your password" : "Choose a password"}
        htmlFor="password"
        error={fieldErrors.password}
        hint={hasAccount ? undefined : "At least 10 characters."}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={hasAccount ? "current-password" : "new-password"}
          required
          autoFocus
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Accept invitation
      </Button>
    </form>
  );
}
