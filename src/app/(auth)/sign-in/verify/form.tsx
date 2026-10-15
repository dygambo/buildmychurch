"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { signOutAction, verifyMfaAction } from "../../actions";

export function VerifyForm() {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction(verifyMfaAction, { onSuccess: (d) => router.replace(d.next) });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run({ code: String(new FormData(e.currentTarget).get("code") ?? "") });
      }}
    >
      <Field label="Verification code" htmlFor="code" error={fieldErrors.code}>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          className="h-12 text-center font-mono text-xl tracking-[.3em]"
          maxLength={10}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Verify and continue
      </Button>
      <Button type="button" variant="ghost" className="w-full justify-center" onClick={() => signOutAction()}>
        Cancel and sign out
      </Button>
    </form>
  );
}
