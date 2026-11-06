"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction, formToObject } from "@/components/ui/use-action";
import { signInAction } from "../actions";

export function SignInForm() {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction(signInAction, { onSuccess: (d) => router.replace(d.next) });
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(formToObject(e.currentTarget) as { email: string; password: string });
      }}
    >
      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          aria-invalid={!!fieldErrors.email}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!fieldErrors.password}
        />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-[13px] text-accent hover:underline">
          Forgot your password?
        </Link>
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
