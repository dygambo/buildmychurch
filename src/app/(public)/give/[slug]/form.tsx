"use client";
import { useMemo, useState, useTransition } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { grossUp } from "@/lib/fees";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { startGiftAction } from "../../actions";

type Fund = { id: string; name: string; description: string | null };
type Project = { id: string; name: string; description: string | null; goalKobo: number; raised: number };
const PRESETS = [1000, 2000, 5000, 10000, 20000, 50000];

export function GiveForm({
  slug,
  church,
  testMode,
  funds,
  projects,
  branches,
  preset,
}: {
  slug: string;
  church: string;
  testMode: boolean;
  funds: Fund[];
  projects: Project[];
  branches: { id: string; name: string; hq: boolean }[];
  preset: { project?: string; fund?: string };
}) {
  const initial = preset.project && projects.some((p) => p.id === preset.project)
    ? `p:${preset.project}`
    : `f:${funds.find((f) => f.id === preset.fund)?.id ?? funds[0]?.id ?? ""}`;
  const [target, setTarget] = useState(initial);
  const [amount, setAmount] = useState("5000");
  const [cover, setCover] = useState(true);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const kobo = Math.round(Number(amount.replace(/[,\s₦]/g, "")) * 100) || 0;
  const charge = useMemo(() => (cover && kobo >= 10_000 ? grossUp(kobo) : kobo), [cover, kobo]);

  return (
    <Card>
      <CardBody>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const values: Record<string, unknown> = {
              fundId: target.startsWith("f:") ? target.slice(2) : "",
              campaignId: target.startsWith("p:") ? target.slice(2) : "",
              branchId: fd.get("branchId") ?? "",
              amount,
              coverFees: cover,
              name: fd.get("name"),
              email: fd.get("email"),
              phone: fd.get("phone"),
              anonymous: fd.get("anonymous") === "on",
            };
            setError(null);
            start(async () => {
              const r = await startGiftAction({ slug, values });
              if (r.ok) window.location.assign(r.data.url);
              else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            });
          }}
        >
          {testMode && (
            <Note tone="warn">
              Test mode: no real money moves. You&apos;ll see a practice checkout instead of Paystack.
            </Note>
          )}
          {error && <Note tone="bad">{error}</Note>}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[12.5px] font-medium text-muted">What are you giving to?</legend>
            <div className="grid grid-cols-2 gap-2">
              {funds.map((f) => (
                <Choice
                  key={f.id}
                  name="target"
                  value={`f:${f.id}`}
                  checked={target === `f:${f.id}`}
                  onChange={setTarget}
                  label={f.name}
                />
              ))}
            </div>
            {projects.length > 0 && (
              <div className="mt-1 flex flex-col gap-2">
                {projects.map((p) => {
                  const pct = p.goalKobo ? Math.min(100, Math.round((p.raised / p.goalKobo) * 100)) : 0;
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 text-[13px]",
                        target === `p:${p.id}` ? "border-accent bg-accent-soft" : "border-line-strong",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="target"
                          value={`p:${p.id}`}
                          checked={target === `p:${p.id}`}
                          onChange={() => setTarget(`p:${p.id}`)}
                          className="accent-[var(--accent)]"
                        />
                        <b className="font-semibold">{p.name}</b>
                        <span className="ml-auto text-xs text-faint">{pct}% raised</span>
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-xs text-muted">
                        {naira(p.raised, { compact: true })} of {naira(p.goalKobo, { compact: true })}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {errors.fundId && <p className="text-xs text-bad">{errors.fundId}</p>}
          </fieldset>

          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-medium text-muted">Amount</span>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setAmount(String(a))}
                  className={cn(
                    "tabular h-10 rounded-lg border text-[13px] font-semibold",
                    Number(amount) === a ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface",
                  )}
                >
                  {naira(a * 100)}
                </button>
              ))}
            </div>
            <Field label="Or enter an amount (₦)" htmlFor="g-amount" error={errors.amount}>
              <Input
                id="g-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular text-base"
              />
            </Field>
            <Checkbox
              checked={cover}
              onChange={(e) => setCover(e.target.checked)}
              label={
                kobo >= 10_000
                  ? `Add ${naira(charge - kobo)} so ${church} receives the full ${naira(kobo)}`
                  : "Cover the card and transfer fee"
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Your name" htmlFor="g-name" error={errors.name} className="col-span-full">
              <Input id="g-name" name="name" required autoComplete="name" />
            </Field>
            <Field label="Email for your receipt" htmlFor="g-email" error={errors.email} className="col-span-full">
              <Input id="g-email" name="email" type="email" required autoComplete="email" />
            </Field>
            <Field label="Phone" htmlFor="g-phone" error={errors.phone} optional className="col-span-full">
              <Input id="g-phone" name="phone" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" />
            </Field>
            {branches.length > 1 && (
              <Field label="Branch" htmlFor="g-branch" className="col-span-full">
                <Select id="g-branch" name="branchId" defaultValue={branches.find((b) => b.hq)?.id}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Checkbox name="anonymous" label="Keep my name off the church's giving reports" className="col-span-full" />
          </div>

          <Button type="submit" variant="primary" size="lg" className="justify-center" loading={pending} disabled={kobo < 10_000}>
            <Lock /> Give {kobo >= 10_000 ? naira(charge) : ""}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-faint">
            <ShieldCheck className="size-3.5" /> Paid securely through Paystack · card, bank transfer or USSD
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[13px] font-medium",
        checked ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}
