"use client";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { FormField } from "@/server/db/schema/care";
import { formAction } from "../../actions";

export function FormFields({ fields, errors, preview }: { fields: FormField[]; errors: Record<string, string>; preview?: boolean }) {
  return (
    <>
      {fields.map((q) => {
        const id = `q-${q.id}`;
        if (q.type === "section")
          return (
            <div key={q.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <h2 className="font-semibold">{q.label}</h2>
              {q.help && <p className="text-xs text-muted">{q.help}</p>}
            </div>
          );
        if (q.type === "choice" || q.type === "multi" || q.type === "yesno") {
          const opts = q.type === "yesno" ? ["Yes", "No"] : (q.options ?? []);
          return (
            <fieldset key={q.id} className="flex flex-col gap-1.5" aria-describedby={errors[q.id] ? `${id}-err` : undefined}>
              <legend className="mb-1 text-[13px] font-medium">
                {q.label}
                {!q.required && <span className="font-normal text-faint"> (optional)</span>}
              </legend>
              {q.help && <p className="-mt-1 text-xs text-faint">{q.help}</p>}
              <div className={q.type === "yesno" ? "flex gap-4" : "flex flex-col gap-1.5"}>
                {opts.map((o) => (
                  <label key={o} className="flex cursor-pointer items-center gap-2 text-[14px]">
                    <input type={q.type === "multi" ? "checkbox" : "radio"} name={q.id} value={o} disabled={preview} className="accent-[var(--accent)]" />
                    {o}
                  </label>
                ))}
              </div>
              {errors[q.id] && (
                <p id={`${id}-err`} className="text-xs text-bad">
                  {errors[q.id]}
                </p>
              )}
            </fieldset>
          );
        }
        return (
          <Field key={q.id} label={q.label} htmlFor={id} error={errors[q.id]} hint={q.help} optional={!q.required}>
            {q.type === "long" ? (
              <Textarea id={id} name={q.id} rows={4} disabled={preview} />
            ) : (
              <Input
                id={id}
                name={q.id}
                disabled={preview}
                type={q.type === "email" ? "email" : q.type === "date" ? "date" : "text"}
                inputMode={q.type === "phone" ? "tel" : q.type === "number" ? "decimal" : undefined}
                autoComplete={q.type === "phone" ? "tel" : q.type === "email" ? "email" : /name/i.test(q.label) ? "name" : undefined}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}

export function PublicForm({ token, fields }: { token: string; fields: FormField[] }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null | false>(false);
  if (done !== false)
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 className="size-10 text-good" />
          <h2 className="text-lg font-semibold">Thank you</h2>
          <p className="text-[13px] whitespace-pre-wrap text-muted">{done || "Your response has been received."}</p>
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
            const answers: Record<string, unknown> = {};
            for (const q of fields) if (q.type !== "section") answers[q.id] = q.type === "multi" ? f.getAll(q.id) : f.get(q.id);
            const r = await formAction({ token, answers });
            setPending(false);
            if (r.ok) setDone(r.data.thankYou);
            else {
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
            }
          }}
        >
          {error && <Note tone="bad">{error}</Note>}
          <FormFields fields={fields} errors={errors} />
          <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending}>
            Submit
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
