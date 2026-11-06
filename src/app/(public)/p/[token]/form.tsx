"use client";
import { useState } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { prayerAction } from "../../actions";

const TOPICS = [
  ["healing", "Healing"],
  ["family", "Family and marriage"],
  ["finances", "Finances"],
  ["career", "Job and career"],
  ["salvation", "Salvation"],
  ["guidance", "Direction"],
  ["deliverance", "Deliverance"],
  ["thanksgiving", "Thanksgiving"],
  ["other", "Something else"],
] as const;

export function PrayerForm({ token }: { token: string }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [contact, setContact] = useState(false);
  if (done)
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 className="size-10 text-good" />
          <h2 className="text-lg font-semibold">We&apos;re praying with you</h2>
          <p className="text-[13px] text-muted">Your request has reached the prayer team.{contact ? " Someone will contact you soon." : ""}</p>
          <p className="mt-2 text-xs text-faint italic">&ldquo;Cast all your anxiety on him because he cares for you.&rdquo; 1 Peter 5:7</p>
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
            const r = await prayerAction({
              token,
              values: {
                name: f.get("name"),
                phone: f.get("phone") ?? "",
                email: f.get("email") ?? "",
                body: f.get("body"),
                category: f.get("category"),
                confidential: f.get("confidential") === "on",
                wantsContact: contact,
              },
            });
            setPending(false);
            if (r.ok) setDone(true);
            else {
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
            }
          }}
        >
          {error && <Note tone="bad">{error}</Note>}
          <Field label="Your prayer request" htmlFor="pr-body" error={errors.body}>
            <Textarea id="pr-body" name="body" rows={5} required />
          </Field>
          <Field label="What is it about?" htmlFor="pr-cat">
            <Select id="pr-cat" name="category" defaultValue="other">
              {TOPICS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your name" htmlFor="pr-name" optional error={errors.name}>
            <Input id="pr-name" name="name" autoComplete="name" />
          </Field>
          <Checkbox label="I'd like someone from the church to contact me" checked={contact} onChange={(e) => setContact(e.target.checked)} />
          {contact && (
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Phone" htmlFor="pr-phone" error={errors.phone}>
                <Input id="pr-phone" name="phone" inputMode="tel" autoComplete="tel" />
              </Field>
              <Field label="Email" htmlFor="pr-email" optional error={errors.email}>
                <Input id="pr-email" name="email" type="email" autoComplete="email" />
              </Field>
            </div>
          )}
          <Checkbox name="confidential" label={<span className="flex items-center gap-1"><Lock className="size-3.5" /> Only the pastors should read this</span>} />
          <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending}>
            Send prayer request
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
