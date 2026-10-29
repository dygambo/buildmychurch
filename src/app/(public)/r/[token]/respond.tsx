"use client";
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/card";
import { respondRotaAction } from "../../actions";

export function RotaResponse({ token, status }: { token: string; status: string }) {
  const [state, setState] = useState(status);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (answer: "confirm" | "decline") => {
    setPending(true);
    const r = await respondRotaAction({ token, answer, reason });
    setPending(false);
    if (r.ok) setState(answer === "confirm" ? "confirmed" : "declined");
    else setError(r.error);
  };
  if (state === "confirmed")
    return (
      <Note tone="good" icon={<CheckCircle2 className="size-4" />}>
        Thank you, you&apos;re confirmed. We&apos;ll send a reminder the day before.
      </Note>
    );
  if (state === "declined")
    return (
      <Note icon={<XCircle className="size-4" />}>
        Thanks for letting us know. Your head of department will find cover. Changed your mind?{" "}
        <button type="button" className="underline" onClick={() => setState("assigned")}>
          Confirm instead
        </button>
      </Note>
    );
  return (
    <div className="flex flex-col gap-2">
      {error && <Note tone="bad">{error}</Note>}
      {declining ? (
        <>
          <Field label="What's stopping you? (optional)" htmlFor="rr">
            <Textarea id="rr" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="danger" loading={pending} onClick={() => send("decline")} className="justify-center">
            I can&apos;t make it
          </Button>
          <Button variant="ghost" onClick={() => setDeclining(false)}>
            Back
          </Button>
        </>
      ) : (
        <>
          <Button variant="primary" size="lg" loading={pending} onClick={() => send("confirm")} className="justify-center">
            <CheckCircle2 /> I&apos;ll be there
          </Button>
          <Button onClick={() => setDeclining(true)} className="justify-center">
            I can&apos;t make it
          </Button>
        </>
      )}
    </div>
  );
}
