"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Lock, Printer, QrCode, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Person } from "@/components/ui/avatar";
import { useAction, formToObject } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import { formatDate, formatTime, fullName } from "@/lib/format";
import { MemberPicker } from "../../members/member-picker";
import { STAGE_LABEL, STAGE_TONE } from "../../members/labels";
import { checkInMemberAction, headcountAction, serviceStatusAction, undoCheckInAction } from "../actions";

type P = {
  id: string;
  title: string | null;
  firstName: string;
  lastName: string;
  memberNo: string;
  stage: string;
  method: string;
  at: string;
};

export function ServiceDesk({
  service: s,
  present,
  checkinUrl,
  canRecord,
}: {
  service: {
    id: string;
    name: string;
    date: string;
    startsAt: string;
    status: string;
    branchName: string;
    men: number | null;
    women: number | null;
    children: number | null;
    online: number | null;
    firstTimersCount: number | null;
    countNotes: string | null;
    headcount: number | null;
  };
  present: P[];
  checkinUrl: string | null;
  canRecord: boolean;
}) {
  const [showQr, setShowQr] = useState(false);
  const checkIn = useAction(checkInMemberAction);
  const undo = useAction(undoCheckInAction);
  const status = useAction(serviceStatusAction);
  const count = useAction(headcountAction);
  const open = s.status === "open";
  const firstTimers = present.filter((p) => p.stage === "first_timer").length;

  return (
    <>
      <Link href="/attendance" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Attendance
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {s.name} <Badge tone={open ? "good" : "neutral"}>{open ? "Open" : "Closed"}</Badge>
          </span>
        }
        description={`${formatDate(s.date, "long")} at ${formatTime(s.startsAt)} · ${s.branchName}`}
        actions={
          canRecord && (
            <>
              {checkinUrl && open && (
                <Button onClick={() => setShowQr((v) => !v)}>
                  <QrCode /> {showQr ? "Hide" : "Show"} self check-in QR
                </Button>
              )}
              <Button
                loading={status.pending}
                onClick={() => status.run({ serviceId: s.id, status: open ? "closed" : "open" })}
              >
                {open ? <Lock /> : <Unlock />} {open ? "Close service" : "Reopen"}
              </Button>
            </>
          )
        }
      />

      {showQr && checkinUrl && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-6">
            <div className="print-area flex flex-col items-center gap-2 bg-white p-4 text-center text-[#0e1a33]">
              <div className="text-sm font-semibold">{s.name}</div>
              <QrImage value={checkinUrl} size={220} label="Self check-in QR code" />
              <div className="text-sm">Scan to check in with your phone number</div>
            </div>
            <div className="flex max-w-md flex-col gap-3 text-[13px] text-muted">
              <p>
                Put this on the screen or print it for the entrance. Members scan it and enter their phone number. It
                works from two hours before the service until six hours after it starts.
              </p>
              <code className="rounded-lg bg-surface-2 px-2 py-1 text-xs break-all text-fg">{checkinUrl}</code>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(checkinUrl);
                    toast.success("Link copied");
                  }}
                >
                  <Copy /> Copy link
                </Button>
                <Button onClick={() => window.print()}>
                  <Printer /> Print
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader
            title={`${present.length.toLocaleString("en-NG")} checked in`}
            action={
              firstTimers > 0 && (
                <Badge tone="warn">
                  {firstTimers} first timer{firstTimers === 1 ? "" : "s"}
                </Badge>
              )
            }
          />
          {canRecord && open && (
            <div className="flex flex-col gap-2 border-b border-line px-4 pb-3">
              <MemberPicker
                placeholder="Check someone in: name, phone or member number"
                exclude={present.map((p) => p.id)}
                onPick={(m) => checkIn.run({ serviceId: s.id, memberId: m.id })}
              />
              <p className="text-xs text-faint">
                New here? Ask them to fill the{" "}
                <Link href="/follow-up?card=1" className="text-accent">
                  visitor card
                </Link>
                .
              </p>
            </div>
          )}
          {present.length === 0 ? (
            <EmptyState title="No one checked in yet">People appear here as they check in, newest first.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="max-sm:hidden">Stage</Th>
                  <Th>Time</Th>
                  {canRecord && open && <Th />}
                </tr>
              </thead>
              <tbody>
                {present.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link href={`/members/${p.id}`} className="block hover:text-accent">
                        <Person name={fullName(p)} sub={p.memberNo} size="sm" />
                      </Link>
                    </Td>
                    <Td className="max-sm:hidden">
                      <Badge tone={STAGE_TONE[p.stage]}>{STAGE_LABEL[p.stage]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {formatTime(p.at)}
                      {p.method === "self_qr" && <span className="text-xs text-faint"> · QR</span>}
                    </Td>
                    {canRecord && open && (
                      <Td className="text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${p.firstName}`}
                          onClick={() => undo.run({ serviceId: s.id, memberId: p.id })}
                        >
                          <X />
                        </Button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Headcount"
            action={
              s.headcount != null && (
                <span className="text-[13px] font-semibold">{s.headcount.toLocaleString("en-NG")} total</span>
              )
            }
          />
          <CardBody>
            {canRecord ? (
              <form
                className="grid grid-cols-2 gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  count.run({ serviceId: s.id, ...(formToObject(e.currentTarget) as Record<string, string>) } as never);
                }}
              >
                <Field label="Men" htmlFor="h-men" error={count.fieldErrors.men}>
                  <Input
                    id="h-men"
                    name="men"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    required
                    defaultValue={s.men ?? ""}
                  />
                </Field>
                <Field label="Women" htmlFor="h-women" error={count.fieldErrors.women}>
                  <Input
                    id="h-women"
                    name="women"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    required
                    defaultValue={s.women ?? ""}
                  />
                </Field>
                <Field label="Children" htmlFor="h-children" error={count.fieldErrors.children}>
                  <Input
                    id="h-children"
                    name="children"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    required
                    defaultValue={s.children ?? ""}
                  />
                </Field>
                <Field label="Online" htmlFor="h-online" optional>
                  <Input
                    id="h-online"
                    name="online"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    defaultValue={s.online ?? ""}
                  />
                </Field>
                <Field label="First timers" htmlFor="h-ft" optional className="col-span-full">
                  <Input
                    id="h-ft"
                    name="firstTimersCount"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    defaultValue={s.firstTimersCount ?? ""}
                  />
                </Field>
                <Field label="Notes" htmlFor="h-notes" optional className="col-span-full">
                  <Input id="h-notes" name="countNotes" defaultValue={s.countNotes ?? ""} />
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  className="col-span-full justify-center"
                  loading={count.pending}
                >
                  Save headcount
                </Button>
              </form>
            ) : s.headcount != null ? (
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <dt className="text-muted">Men</dt>
                <dd>{s.men}</dd>
                <dt className="text-muted">Women</dt>
                <dd>{s.women}</dd>
                <dt className="text-muted">Children</dt>
                <dd>{s.children}</dd>
                <dt className="text-muted">Online</dt>
                <dd>{s.online ?? "—"}</dd>
              </dl>
            ) : (
              <p className="text-[13px] text-muted">No headcount recorded.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
