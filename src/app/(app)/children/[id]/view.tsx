"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  HeartPulse,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { ChildDetail } from "@/server/services/children";
import { rotateQrAction, setChildStatusAction } from "../actions";
import { ChildDrawer } from "../child-form";

type Child = Omit<ChildDetail, "open" | "recent"> & {
  open: { id: string; checkedInAt: string; securityCode: string; classGroup: string | null } | null;
  recent: (Omit<ChildDetail["recent"][number], "checkedInAt" | "checkedOutAt"> & {
    checkedInAt: string;
    checkedOutAt: string | null;
  })[];
};

export function ChildProfile({
  child: c,
  church,
  branches,
  canManage,
  canMedical,
}: {
  child: Child;
  church: string;
  branches: { id: string; name: string }[];
  canManage: boolean;
  canMedical: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const rotate = useAction(rotateQrAction);
  const status = useAction(setChildStatusAction);
  const name = `${c.firstName} ${c.lastName}`;
  return (
    <>
      <Link href="/children" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Children
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold max-sm:text-[19px]">{name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="font-mono">{c.childNo}</span>
            <span>·</span>
            <span>
              {c.age} year{c.age === 1 ? "" : "s"} old · {c.effectiveClass}
            </span>
            {c.open ? <Badge tone="good">In church since {formatTime(c.open.checkedInAt)}</Badge> : null}
            {c.status !== "active" && <Badge tone="warn">{c.status === "graduated" ? "Graduated" : "Inactive"}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" asChild>
            <Link href={`/children/desk?child=${c.id}`}>
              <ScanLine /> {c.open ? "Check out" : "Check in"}
            </Link>
          </Button>
          <Button onClick={() => window.print()}>
            <Printer /> Print tag
          </Button>
          {canManage && (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem onSelect={() => setEditing(true)}>
                  <Pencil /> Edit details
                </DropdownItem>
                <DropdownItem onSelect={() => rotate.run({ id: c.id })}>
                  <RefreshCw /> Replace lost QR tag
                </DropdownItem>
                <DropdownSeparator />
                {c.status === "active" ? (
                  <>
                    <DropdownItem onSelect={() => status.run({ id: c.id, status: "graduated" })}>
                      Mark as graduated
                    </DropdownItem>
                    <DropdownItem onSelect={() => status.run({ id: c.id, status: "inactive" })}>
                      Mark as inactive
                    </DropdownItem>
                  </>
                ) : (
                  <DropdownItem onSelect={() => status.run({ id: c.id, status: "active" })}>Reactivate</DropdownItem>
                )}
              </DropdownContent>
            </Dropdown>
          )}
        </div>
      </div>

      {c.hasMedical &&
        (c.medicalVisible ? (
          <Note tone="bad" icon={<HeartPulse />}>
            {[
              c.allergies && `Allergies: ${c.allergies}`,
              c.medical && `Medical: ${c.medical}`,
              c.specialNeeds && `Special needs: ${c.specialNeeds}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Note>
        ) : (
          <Note tone="warn" icon={<HeartPulse />}>
            This child has medical or allergy notes. Ask a children&apos;s ministry lead before giving food or medicine.
          </Note>
        ))}

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Parents and guardians" />
            <CardBody className="flex flex-col divide-y divide-line">
              {c.guardians.map((g) => (
                <div key={g.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar name={`${g.firstName} ${g.lastName}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {g.title} {g.firstName} {g.lastName}{" "}
                      <span className="font-normal text-muted">· {g.relationship}</span>
                      {g.isPrimary && (
                        <Badge tone="accent" className="ml-1.5">
                          Main contact
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                      {g.phone && (
                        <a href={`tel:${g.phone}`} className="inline-flex items-center gap-1 hover:text-accent">
                          <Phone className="size-3.5" /> {formatPhone(g.phone)}
                        </a>
                      )}
                      {g.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3.5" /> {g.email}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.canPickUp ? (
                        <Badge tone="good">
                          <ShieldCheck className="size-3" /> Can pick up
                        </Badge>
                      ) : (
                        <Badge tone="bad">
                          <ShieldAlert className="size-3" /> Not allowed to pick up
                        </Badge>
                      )}
                      {g.email && g.notify ? <Badge>Gets email alerts</Badge> : <Badge>No email alerts</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Check-in history"
              action={
                canManage && (
                  <Link className="text-[13px] text-accent" href={`/children/records?child=${c.id}`}>
                    All records
                  </Link>
                )
              }
            />
            {c.recent.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>In</Th>
                    <Th>Out</Th>
                    <Th className="max-md:hidden">Picked up by</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.recent.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap">{formatDate(r.checkedInAt)}</Td>
                      <Td
                        className="whitespace-nowrap"
                        title={`By ${r.checkedInByName}, dropped off by ${r.droppedOffBy}`}
                      >
                        {formatTime(r.checkedInAt)}
                        <div className="text-xs text-faint">{r.checkedInByName}</div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {r.checkedOutAt ? (
                          <>
                            {formatTime(r.checkedOutAt)}
                            <div className="text-xs text-faint">{r.checkedOutByName}</div>
                          </>
                        ) : (
                          <Badge tone="good">In church</Badge>
                        )}
                      </Td>
                      <Td className="text-muted max-md:hidden">
                        {r.pickedUpBy}
                        {r.overrideReason && <div className="text-xs text-warn">{r.overrideReason}</div>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody>
                <p className="text-[13px] text-muted">No check-ins yet.</p>
              </CardBody>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="QR tag" />
            <CardBody className="flex flex-col items-center gap-3">
              <div className="print-area flex w-[260px] flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-white p-4 text-center text-[#0e1a33]">
                <div className="text-[11px] font-semibold tracking-wider uppercase">{church}</div>
                <QrImage value={`BMC-CHILD:${c.qrToken}`} size={170} label={`QR tag for ${name}`} />
                <div className="text-lg leading-tight font-bold">{name}</div>
                <div className="text-xs">
                  {c.childNo} · {c.effectiveClass}
                </div>
                {c.hasMedical && (
                  <div className="rounded bg-[#fde8e8] px-2 py-0.5 text-[11px] font-semibold text-[#b42318]">
                    See medical notes
                  </div>
                )}
              </div>
              <p className="text-center text-xs text-faint">
                Print and attach to the child&apos;s bag, or let parents keep a photo of it. Lost tags can be replaced;
                the old one stops working.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody className="flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between gap-2">
                <span className="text-muted">Date of birth</span>
                <span>{formatDate(c.dob, "long")}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Gender</span>
                <span>{c.gender === "male" ? "Boy" : "Girl"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Branch</span>
                <span>{c.branchName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Photos</span>
                <span>{c.photoConsent ? "Allowed" : "Not allowed"}</span>
              </div>
              {c.notes && <p className="mt-1 rounded-lg bg-surface-2 p-2.5 text-muted">{c.notes}</p>}
              {c.open && (
                <p className="text-xs text-faint">
                  Checked in {formatDateTime(c.open.checkedInAt)} · pickup code {c.open.securityCode}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      {canManage && (
        <ChildDrawer
          open={editing}
          onOpenChange={setEditing}
          id={c.id}
          branches={branches}
          canMedical={canMedical}
          initial={{
            ...c,
            guardians: c.guardians.map((g) => ({ ...g, phone: g.phone ?? "", email: g.email ?? "" })),
          }}
        />
      )}
    </>
  );
}
