"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, HeartPulse, LogIn, LogOut, Printer, Search, ShieldAlert, Undo2, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { Scanner } from "@/components/scanner";
import { formatTime } from "@/lib/format";
import { localPhone } from "@/lib/phone";
import { cancelCheckInAction, checkInAction, checkOutAction, deskLookupAction, deskSearchAction } from "../actions";

type Here = {
  checkinId: string;
  childId: string;
  firstName: string;
  lastName: string;
  classGroup: string | null;
  securityCode: string;
  checkedInAt: string;
  checkedInByName: string;
  hasMedical: boolean;
  droppedOff: string;
};
type Found = Extract<Awaited<ReturnType<typeof deskLookupAction>>, { ok: true }>["data"];

export function Desk({
  church,
  here,
  services,
  initialChild,
  canOverride,
}: {
  church: string;
  here: Here[];
  services: { id: string; name: string }[];
  initialChild: string | null;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [child, setChild] = useState<Found | null>(null);
  const [via, setVia] = useState<"qr" | "manual">("manual");
  const [slip, setSlip] = useState<{ name: string; code: string; classGroup: string; at: string } | null>(null);
  const lookup = useAction(deskLookupAction, { onSuccess: (d) => setChild(d) });
  const opened = useRef(false);

  useEffect(() => {
    if (initialChild && !opened.current) {
      opened.current = true;
      void lookup.run({ childId: initialChild });
    }
  }, [initialChild, lookup]);

  const open = (id: string, method: "qr" | "manual") => {
    setVia(method);
    void lookup.run({ childId: id });
  };
  const close = () => {
    setChild(null);
    router.refresh();
  };
  const classes = [...new Set(here.map((h) => h.classGroup ?? "Unassigned"))];

  return (
    <>
      <PageHeader
        title="Check-in desk"
        description="Scan a child's QR tag, or search by the child's or a parent's name."
      />
      <div className="grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <Scanner
                paused={!!child || lookup.pending}
                onScan={(text) => {
                  setVia("qr");
                  void lookup.run({ qr: text });
                }}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Or search" />
            <CardBody>
              <ChildSearch onPick={(id) => open(id, "manual")} />
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Users className="size-4" /> In church now <Badge tone="good">{here.length}</Badge>
              </span>
            }
          />
          {here.length === 0 ? (
            <EmptyState icon={<Users />} title="No children checked in">
              Children appear here as they are checked in, grouped by class with their pickup codes.
            </EmptyState>
          ) : (
            <CardBody className="flex flex-col gap-4">
              {classes.map((cl) => (
                <section key={cl}>
                  <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {cl} · {here.filter((h) => (h.classGroup ?? "Unassigned") === cl).length}
                  </h4>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
                    {here
                      .filter((h) => (h.classGroup ?? "Unassigned") === cl)
                      .map((h) => (
                        <li key={h.checkinId}>
                          <button
                            onClick={() => open(h.childId, "manual")}
                            className="flex w-full items-center gap-2.5 rounded-xl border border-line p-2.5 text-left hover:border-accent-line hover:bg-surface-2"
                          >
                            <Avatar name={`${h.firstName} ${h.lastName}`} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1 truncate font-medium">
                                {h.firstName} {h.lastName}
                                {h.hasMedical && (
                                  <HeartPulse className="size-3.5 shrink-0 text-bad" aria-label="Medical notes" />
                                )}
                              </span>
                              <span className="block truncate text-xs text-faint">
                                {formatTime(h.checkedInAt)} · {h.droppedOff}
                              </span>
                            </span>
                            <span className="font-mono text-xs font-semibold tracking-wider text-muted">
                              {h.securityCode}
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </CardBody>
          )}
        </Card>
      </div>

      <Dialog open={!!child} onOpenChange={(o) => !o && close()}>
        {child && (
          <DeskDialog
            key={child.id + (child.open ? "in" : "out")}
            child={child}
            via={via}
            services={services}
            canOverride={canOverride}
            onCheckedIn={(code, classGroup) => {
              setSlip({ name: child.name, code, classGroup, at: new Date().toISOString() });
              close();
            }}
            onDone={close}
          />
        )}
      </Dialog>

      <Dialog open={!!slip} onOpenChange={(o) => !o && setSlip(null)}>
        {slip && (
          <DialogContent
            title="Checked in"
            footer={
              <>
                <Button onClick={() => window.print()}>
                  <Printer /> Print pickup slip
                </Button>
                <Button variant="primary" onClick={() => setSlip(null)}>
                  Done
                </Button>
              </>
            }
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="size-10 text-good" />
              <p className="text-[13px] text-muted">
                Give the parent the pickup code. They&apos;ll need it to collect {slip.name.split(" ")[0]}.
              </p>
              <div className="print-area flex w-[280px] flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-line-strong bg-white p-4 text-[#0e1a33]">
                <div className="text-[11px] font-semibold tracking-wider uppercase">{church} · Pickup slip</div>
                <div className="text-lg font-bold">{slip.name}</div>
                <div className="text-xs">
                  {slip.classGroup} · in at {formatTime(slip.at)}
                </div>
                <div
                  className="mt-1 font-mono text-[40px] leading-none font-bold tracking-[.2em]"
                  data-testid="pickup-code"
                >
                  {slip.code}
                </div>
                <div className="text-[11px]">Show this code to collect your child</div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function DeskDialog({
  child,
  via,
  services,
  canOverride,
  onCheckedIn,
  onDone,
}: {
  child: Found;
  via: "qr" | "manual";
  services: { id: string; name: string }[];
  canOverride: boolean;
  onCheckedIn: (code: string, classGroup: string) => void;
  onDone: () => void;
}) {
  const isIn = !!child.open;
  const [who, setWho] = useState<string>(
    isIn ? "" : (child.guardians.find((g) => g.isPrimary)?.id ?? child.guardians[0]?.id ?? ""),
  );
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [service, setService] = useState(services.length === 1 ? services[0]!.id : "");
  const checkIn = useAction(checkInAction, { onSuccess: (d) => onCheckedIn(d.securityCode, d.classGroup) });
  const checkOut = useAction(checkOutAction, { onSuccess: onDone });
  const cancel = useAction(cancelCheckInAction, { onSuccess: onDone });
  const chosen = child.guardians.find((g) => g.id === who);
  const needsOverride = isIn && chosen && !chosen.canPickUp;
  const recent = !!child.open?.canCancel;
  const anyEmail = child.guardians.some((g) => g.hasEmail);

  return (
    <DialogContent
      title={
        <span className="flex items-center gap-2">
          {child.name}
          <Badge tone={isIn ? "good" : "neutral"}>
            {isIn ? `In since ${formatTime(child.open!.checkedInAt)}` : "Not checked in"}
          </Badge>
        </span>
      }
      description={`${child.childNo} · ${child.age} years · ${child.open?.classGroup ?? child.classGroup}`}
      footer={
        isIn ? (
          <>
            {recent && (
              <Button
                variant="ghost"
                className="mr-auto"
                loading={cancel.pending}
                onClick={() => cancel.run({ childId: child.id })}
              >
                <Undo2 /> Cancel check-in
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!who || (needsOverride && (!canOverride || reason.trim().length < 5))}
              loading={checkOut.pending}
              onClick={() =>
                checkOut.run({
                  childId: child.id,
                  pickedUpBy: who,
                  method: code.trim() ? "code" : via,
                  securityCode: code.trim() || undefined,
                  overrideReason: needsOverride ? reason : undefined,
                })
              }
            >
              <LogOut /> Check out
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={!who || child.status !== "active"}
            loading={checkIn.pending}
            onClick={() =>
              checkIn.run({ childId: child.id, droppedOffBy: who, method: via, serviceId: service || undefined })
            }
          >
            <LogIn /> Check in
          </Button>
        )
      }
    >
      {child.hasMedical && (
        <Note tone="bad" icon={<HeartPulse />}>
          {child.allergies || child.medical || child.specialNeeds
            ? [child.allergies && `Allergies: ${child.allergies}`, child.medical, child.specialNeeds]
                .filter(Boolean)
                .join(" · ")
            : "Has medical or allergy notes. Ask a lead before giving food or medicine."}
        </Note>
      )}
      {child.status !== "active" && (
        <Note tone="warn">This record is marked {child.status}. A lead can reactivate it.</Note>
      )}
      {!isIn && services.length > 0 && (
        <Field label="Service" htmlFor="d-service" optional>
          <Select id="d-service" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Not linked to a service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[12.5px] font-medium text-muted">
          {isIn ? "Who is picking up?" : "Who is dropping off?"}
        </legend>
        {child.guardians.map((g) => (
          <label
            key={g.id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 ${who === g.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
          >
            <input
              type="radio"
              name="who"
              className="accent-[var(--accent)]"
              checked={who === g.id}
              onChange={() => setWho(g.id)}
            />
            <Avatar name={g.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{g.name}</span>
              <span className="text-xs text-faint">
                {g.relationship}
                {g.phone && ` · ${localPhone(g.phone)}`}
              </span>
            </span>
            {isIn && !g.canPickUp && (
              <Badge tone="bad">
                <ShieldAlert className="size-3" /> Not on pickup list
              </Badge>
            )}
          </label>
        ))}
      </fieldset>
      {isIn && (
        <Field
          label="Pickup code from the parent's slip"
          htmlFor="d-code"
          optional
          hint="Recommended. Ask for it if you don't know the person."
        >
          <Input
            id="d-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            className="w-32 font-mono tracking-[.3em] uppercase"
            autoComplete="off"
          />
        </Field>
      )}
      {checkOut.fieldErrors.securityCode && (
        <p className="-mt-2 text-xs text-bad">{checkOut.fieldErrors.securityCode}</p>
      )}
      {needsOverride &&
        (canOverride ? (
          <Field
            label="Why are you releasing the child to this person?"
            htmlFor="d-reason"
            error={checkOut.fieldErrors.overrideReason}
          >
            <Textarea
              id="d-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Mother phoned the children's pastor to authorise"
            />
          </Field>
        ) : (
          <Note tone="bad" icon={<ShieldAlert />}>
            {chosen!.name} isn&apos;t allowed to pick {child.firstName} up. Call the main guardian or a children&apos;s
            ministry lead.
          </Note>
        ))}
      <p className="text-xs text-faint">
        {anyEmail
          ? `Parents get an email straight away saying who ${isIn ? "picked up" : "dropped off"} ${child.firstName} and who ${isIn ? "checked them out" : "checked them in"}.`
          : "No guardian has email alerts on, so no email will be sent."}
      </p>
    </DialogContent>
  );
}

function ChildSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; classGroup: string; here: boolean; parent: string }[]
  >([]);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-faint" />
        <Input
          type="search"
          aria-label="Search children"
          placeholder="Child or parent name, or parent's phone"
          className="pl-8"
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            clearTimeout(t.current);
            t.current = setTimeout(async () => {
              const r = await deskSearchAction({ q: v });
              setResults(r.ok ? r.data : []);
            }, 200);
          }}
        />
      </div>
      {q.trim().length >= 2 && (
        <ul className="flex flex-col gap-1">
          {results.length ? (
            results.map((r) => (
              <li key={r.id}>
                <button
                  className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-surface-2"
                  onClick={() => {
                    onPick(r.id);
                    setQ("");
                    setResults([]);
                  }}
                >
                  <Avatar name={r.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-faint">
                      {r.classGroup}
                      {r.parent && ` · ${r.parent}`}
                    </span>
                  </span>
                  {r.here && <Badge tone="good">In</Badge>}
                </button>
              </li>
            ))
          ) : (
            <li className="p-2 text-[13px] text-muted">No children found.</li>
          )}
        </ul>
      )}
    </div>
  );
}
