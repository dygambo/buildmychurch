"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/input";
import { addPrayerAction } from "../actions";

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

export function PortalPrayerForm({ slug }: { slug: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Card>
      <CardBody>
        <form
          ref={form}
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending) return;
            setPending(true);
            setError(null);
            const f = new FormData(e.currentTarget);
            const r = await addPrayerAction(slug, {
              body: f.get("body"),
              category: f.get("category"),
              confidential: f.get("confidential") === "on",
              wantsContact: f.get("wantsContact") === "on",
            });
            setPending(false);
            if (r.ok) {
              form.current?.reset();
              setErrors({});
              toast.success("Sent. The prayer team will pray with you.");
              router.refresh();
            } else {
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
            }
          }}
        >
          {error && <Note tone="bad">{error}</Note>}
          <Field label="How can we pray with you?" htmlFor="pp-body" error={errors.body}>
            <Textarea id="pp-body" name="body" rows={4} />
          </Field>
          <Field label="Topic" htmlFor="pp-cat">
            <Select id="pp-cat" name="category" defaultValue="other">
              {TOPICS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox name="wantsContact" label="I'd like a pastor to contact me" />
          <Checkbox name="confidential" label="Only the pastors should read this" />
          <Button type="submit" variant="primary" loading={pending} className="justify-center">
            Send prayer request
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
