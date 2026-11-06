"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, UserPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Scanner } from "@/components/scanner";
import { formToObject, useAction } from "@/components/ui/use-action";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checkInAction, deskAction } from "../../actions";

type Result = { ok: true; name: string; ticket: string; admitted: number; remaining: number; quantity: number } | { ok: false; error: string };

export function CheckinDesk({ e }: { e: { id: string; title: string; types: { id: string; name: string; priceKobo: number }[]; sold: number; inside: number } }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (raw: string, count = 20) => {
    if (busy || !raw.trim()) return;
    setBusy(true);
    const r = await checkInAction({ eventId: e.id, code: raw, count });
    setBusy(false);
    setResult(r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error });
    if (r.ok) {
      setCode("");
      router.refresh();
    }
  };
  const desk = useAction(deskAction, { onSuccess: () => router.refresh() });
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/events/${e.id}`}>
            <ArrowLeft /> {e.title}
          </Link>
        </Button>
      </div>
      <PageHeader title="Check-in" description={`${e.inside.toLocaleString("en-NG")} of ${e.sold.toLocaleString("en-NG")} checked in.`} />
      <div className="grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader title="Scan a ticket" />
          <CardBody className="flex flex-col gap-3">
            <Scanner onScan={(t) => check(t)} paused={busy} />
            <form
              className="flex gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                check(code);
              }}
            >
              <Input aria-label="Ticket code" value={code} onChange={(ev) => setCode(ev.target.value.toUpperCase())} placeholder="Or type the code, e.g. K7M2Q9XRP4" className="font-mono" />
              <Button type="submit" variant="primary" loading={busy}>
                Check in
              </Button>
            </form>
            {result && (
              <div
                role="status"
                data-testid="checkin-result"
                className={cn("flex items-start gap-3 rounded-xl p-4", result.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}
              >
                {result.ok ? <CheckCircle2 className="size-7 shrink-0" /> : <XCircle className="size-7 shrink-0" />}
                <div className="text-[13px]">
                  {result.ok ? (
                    <>
                      <div className="text-base font-semibold">Welcome, {result.name}</div>
                      <div>
                        {result.admitted} × {result.ticket} admitted
                        {result.remaining ? `. ${result.remaining} more on this ticket can come in later.` : "."}
                      </div>
                    </>
                  ) : (
                    <div className="font-medium">{result.error}</div>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Register at the door" />
          <CardBody>
            <form
              id="desk"
              className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
              onSubmit={(ev) => {
                ev.preventDefault();
                const v = formToObject(ev.currentTarget) as Record<string, string | boolean>;
                desk.run({ ...v, eventId: e.id } as Parameters<typeof deskAction>[0]).then((r) => r?.ok && (ev.target as HTMLFormElement).reset());
              }}
            >
              <Field label="Name" htmlFor="dk-name" error={desk.fieldErrors.name} className="col-span-full">
                <Input id="dk-name" name="name" />
              </Field>
              <Field label="Phone" htmlFor="dk-phone" optional>
                <Input id="dk-phone" name="phone" inputMode="tel" />
              </Field>
              <Field label="Email" htmlFor="dk-email" optional hint="To send them a ticket">
                <Input id="dk-email" name="email" type="email" />
              </Field>
              <Field label="Ticket" htmlFor="dk-type">
                <Select id="dk-type" name="ticketTypeId">
                  {e.types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.priceKobo ? `(${naira(t.priceKobo)})` : "(free)"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How many" htmlFor="dk-qty">
                <Input id="dk-qty" name="quantity" inputMode="numeric" defaultValue="1" />
              </Field>
              <Checkbox name="checkIn" defaultChecked label="Check them in now" className="col-span-full" />
              <p className="col-span-full text-xs text-faint">Money taken at the door is counted with the offering, not here.</p>
              <Button type="submit" variant="primary" loading={desk.pending} className="col-span-full justify-center">
                <UserPlus /> Register
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
