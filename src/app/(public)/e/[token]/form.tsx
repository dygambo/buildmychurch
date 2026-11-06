"use client";
import { useState } from "react";
import { Lock, Minus, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { registerEventAction } from "../../actions";

type T = { id: string; name: string; priceKobo: number; left: number | null };

export function RegisterForm({ token, types, askPhone, testMode, left }: { token: string; types: T[]; askPhone: boolean; testMode: boolean; left: number | null }) {
  const available = types.filter((t) => t.left !== 0);
  const [typeId, setTypeId] = useState(available[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = types.find((x) => x.id === typeId);
  const max = Math.min(10, t?.left ?? 10);
  const total = (t?.priceKobo ?? 0) * qty;
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
            const r = await registerEventAction({
              token,
              values: { ticketTypeId: typeId, quantity: qty, name: f.get("name"), email: f.get("email"), phone: f.get("phone") ?? "" },
            });
            if (r.ok) window.location.href = r.data.url;
            else {
              setPending(false);
              setError(r.error);
              setErrors(r.fieldErrors ?? {});
            }
          }}
        >
          {testMode && total > 0 && <Note tone="warn">Test mode: no real money moves.</Note>}
          {error && <Note tone="bad">{error}</Note>}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Ticket</legend>
            {types.map((x) => (
              <label
                key={x.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[14px]",
                  x.left === 0 ? "cursor-not-allowed opacity-50" : typeId === x.id ? "border-accent bg-accent-soft" : "border-line-strong",
                )}
              >
                <input type="radio" name="ticket" value={x.id} checked={typeId === x.id} disabled={x.left === 0} onChange={() => setTypeId(x.id)} className="accent-[var(--accent)]" />
                <Ticket className="size-4 text-faint" />
                <span className="flex-1 font-medium">{x.name}</span>
                <span className="text-right">
                  <span className="font-semibold">{x.priceKobo ? naira(x.priceKobo) : "Free"}</span>
                  {x.left !== null && <span className="block text-xs text-muted">{x.left === 0 ? "Sold out" : `${x.left} left`}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted">How many</span>
            <div className="flex items-center gap-2">
              <Button size="icon-sm" type="button" aria-label="Fewer" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
                <Minus />
              </Button>
              <span className="tabular w-6 text-center font-semibold" data-testid="qty">
                {qty}
              </span>
              <Button size="icon-sm" type="button" aria-label="More" disabled={qty >= max} onClick={() => setQty((q) => q + 1)}>
                <Plus />
              </Button>
            </div>
          </div>
          {errors.quantity && <p className="text-xs text-bad">{errors.quantity}</p>}
          <Field label="Your full name" htmlFor="r-name" error={errors.name}>
            <Input id="r-name" name="name" autoComplete="name" required />
          </Field>
          <Field label="Email for your ticket" htmlFor="r-email" error={errors.email}>
            <Input id="r-email" name="email" type="email" autoComplete="email" required />
          </Field>
          {askPhone && (
            <Field label="Phone" htmlFor="r-phone" error={errors.phone} optional>
              <Input id="r-phone" name="phone" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" />
            </Field>
          )}
          <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending} disabled={!t}>
            {total > 0 ? (
              <>
                <Lock /> Pay {naira(total)}
              </>
            ) : (
              "Register"
            )}
          </Button>
          {left !== null && left < 20 && <p className="text-center text-xs text-warn">Only {left} places left.</p>}
        </form>
      </CardBody>
    </Card>
  );
}
