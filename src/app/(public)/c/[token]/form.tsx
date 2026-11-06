"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { selfCheckInAction } from "../../actions";

export function SelfCheckin({ token, visitorHref }: { token: string; visitorHref: string | null }) {
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "done"; name: string; already: boolean }
    | { kind: "unknown" }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });
  const [pending, start] = useTransition();
  if (state.kind === "done")
    return (
      <div className="flex flex-col items-center gap-3" role="status">
        <CheckCircle2 className="size-14 text-good" />
        <p className="text-lg font-semibold">
          {state.already ? `You're already checked in, ${state.name}.` : `Welcome, ${state.name}! You're checked in.`}
        </p>
        <p className="text-[13px] text-muted">Enjoy the service.</p>
      </div>
    );
  return (
    <form
      className="flex w-full flex-col gap-4 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await selfCheckInAction({ token, phone });
          if (!r.ok) setState({ kind: "error", msg: r.error });
          else if (!r.data.found) setState({ kind: "unknown" });
          else setState({ kind: "done", name: r.data.firstName, already: r.data.already });
        });
      }}
    >
      <Field label="Your phone number" htmlFor="sc-phone" error={state.kind === "error" ? state.msg : undefined}>
        <Input
          id="sc-phone"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="0803 123 4567"
          className="h-12 text-lg"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending}>
        Check in
      </Button>
      {state.kind === "unknown" && (
        <div className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted" role="status">
          We couldn&apos;t find that number in our records.{" "}
          {visitorHref ? (
            <>
              If you&apos;re new,{" "}
              <Link href={visitorHref} className="inline-flex items-center gap-1 font-semibold text-accent">
                <UserPlus className="size-3.5" /> fill our visitor card
              </Link>
              . Otherwise, an usher can check you in.
            </>
          ) : (
            "An usher can check you in."
          )}
        </div>
      )}
      <p className="text-center text-xs text-faint">Your number is only used to find your church record.</p>
    </form>
  );
}
