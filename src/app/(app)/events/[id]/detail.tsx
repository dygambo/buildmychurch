"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Ban, Copy, Download, MapPin, Pencil, QrCode, ScanLine, Send, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import { formatDate, formatDateTime, formatTime, naira } from "@/lib/format";
import type { getEvent, RegistrationRow } from "@/server/services/events";
import { cancelRegistrationAction, eventStatusAction } from "../actions";
import { EventDialog, toLocal } from "../event-dialog";
import { EVENT_STATUS } from "../view";

type E = Awaited<ReturnType<typeof getEvent>>;

export function EventDetail({ e, regs, branches, status }: { e: E; regs: RegistrationRow[]; branches: { id: string; name: string }[]; status: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const st = useAction(eventStatusAction, {
    onSuccess: () => {
      setConfirmCancel(false);
      router.refresh();
    },
  });
  const cancelReg = useAction(cancelRegistrationAction, { onSuccess: () => router.refresh() });
  const sold = e.types.reduce((t, x) => t + x.sold, 0);
  const inside = e.types.reduce((t, x) => t + x.inside, 0);
  const revenue = e.types.reduce((t, x) => t + x.revenue, 0);
  const s = EVENT_STATUS[e.status];
  const href = (v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set("status", v);
    else next.delete("status");
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/events">
            <ArrowLeft /> Events
          </Link>
        </Button>
      </div>
      <PageHeader
        title={e.title}
        description={`${formatDate(e.startsAt, "long")}, ${formatTime(e.startsAt)}${e.venue ? ` · ${e.venue}` : ""}`}
        actions={
          <>
            <Badge tone={s.tone}>{s.label}</Badge>
            {e.status !== "cancelled" && (
              <Button variant="ghost" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {e.status === "published" && (
              <Button asChild>
                <Link href={`/events/${e.id}/checkin`}>
                  <ScanLine /> Check-in
                </Link>
              </Button>
            )}
            {e.status === "draft" && (
              <Button variant="primary" loading={st.pending} onClick={() => st.run({ id: e.id, status: "published" })}>
                <Send /> Open registration
              </Button>
            )}
          </>
        }
      />
      {e.status === "cancelled" && <Note tone="bad">This event was cancelled. Registered people were emailed.</Note>}
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label="Registered" value={sold.toLocaleString("en-NG")} sub={e.capacity ? `${Math.max(0, e.capacity - sold)} places left` : "No limit"} />
        <Stat label="Checked in" value={inside.toLocaleString("en-NG")} sub={sold ? `${Math.round((inside / sold) * 100)}% of registered` : undefined} />
        <Stat label="Ticket income" value={naira(revenue)} sub="Paid online, in giving as Event tickets" />
        <Stat label="Registrations" value={regs.length.toLocaleString("en-NG")} sub="People or groups who signed up" />
      </div>
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <LinkTabs
              current={status || "confirmed"}
              tabs={[
                { key: "confirmed", label: "Confirmed", href: href("") },
                { key: "pending", label: "Waiting for payment", href: href("pending") },
                { key: "all", label: "Everything", href: href("all") },
              ]}
            />
            <SearchBox placeholder="Name, code, phone" className="ml-auto w-52 max-sm:w-full" />
            <Button asChild size="sm" variant="ghost">
              <a href={`/events/${e.id}/export`}>
                <Download /> Excel
              </a>
            </Button>
          </div>
          {regs.length === 0 ? (
            <EmptyState title="No registrations yet">{e.status === "draft" ? "Open registration to start taking sign-ups." : "Share the link or QR code."}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="max-md:hidden">Ticket</Th>
                  <Th>In</Th>
                  <Th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {regs.map((r) => (
                  <Tr key={r.id} className={r.status === "cancelled" || r.status === "failed" ? "opacity-60" : undefined}>
                    <Td>
                      {r.memberId ? (
                        <Link href={`/members/${r.memberId}`} className="font-medium hover:text-accent">
                          {r.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
                      <div className="text-xs text-muted">
                        {[r.phone, r.email, r.source === "desk" ? "at the door" : null].filter(Boolean).join(" · ")}
                      </div>
                    </Td>
                    <Td className="max-md:hidden">
                      {r.quantity} × {r.ticket}
                      {r.amountKobo > 0 && <div className="text-xs text-muted">{naira(r.amountKobo)}</div>}
                      <div className="font-mono text-xs text-faint">{r.code}</div>
                    </Td>
                    <Td>
                      {r.status !== "confirmed" ? (
                        <Badge tone={r.status === "pending" ? "warn" : "neutral"}>{r.status === "pending" ? "Not paid" : r.status === "failed" ? "Payment failed" : "Cancelled"}</Badge>
                      ) : r.checkedIn ? (
                        <Badge tone="good">
                          {r.checkedIn}/{r.quantity}
                        </Badge>
                      ) : (
                        <span className="text-xs text-faint">Not yet</span>
                      )}
                    </Td>
                    <Td>
                      {r.status === "confirmed" && !r.checkedIn && (
                        <Button size="icon-sm" variant="ghost" aria-label={`Cancel ${r.name}'s registration`} onClick={() => cancelReg.run({ id: r.id, eventId: e.id })}>
                          <X />
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          {e.publicUrl && (
            <Card>
              <CardHeader title="Registration page" />
              <CardBody className="flex items-start gap-4 max-sm:flex-col">
                <QrImage value={e.publicUrl} size={110} label="QR code for the registration page" />
                <div className="flex min-w-0 flex-col gap-2 text-[13px]">
                  <code className="truncate rounded bg-surface-2 px-2 py-1 font-mono text-xs" data-testid="event-link">
                    {e.publicUrl.replace(/^https?:\/\//, "")}
                  </code>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        navigator.clipboard.writeText(e.publicUrl!).then(
                          () => toast.success("Link copied"),
                          () => toast.error("Couldn't copy the link"),
                        )
                      }
                    >
                      <Copy /> Copy link
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={e.publicUrl} target="_blank" rel="noopener">
                        <QrCode /> Open
                      </a>
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Tickets" />
            <ul className="divide-y divide-line text-[13px]">
              {e.types
                .filter((t) => !t.archivedAt)
                .map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span>
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted">{t.priceKobo ? naira(t.priceKobo) : "Free"}</span>
                    </span>
                    <span className="tabular text-right">
                      {t.sold}
                      {t.capacity ? ` / ${t.capacity}` : ""}
                      <span className="block text-xs text-faint">{t.inside} in</span>
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
          {e.description && (
            <Card>
              <CardBody className="text-[13px] whitespace-pre-wrap text-muted">{e.description}</CardBody>
            </Card>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-faint">
            {e.venue && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" /> {e.venue}
              </span>
            )}
            {e.closesAt && <span>Registration closes {formatDateTime(e.closesAt)}</span>}
          </div>
          {e.status === "published" && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => st.run({ id: e.id, status: "draft" })}>
                <Undo2 /> Close registration
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>
                <Ban /> Cancel event
              </Button>
            </div>
          )}
        </div>
      </div>
      <EventDialog
        open={editing}
        onOpenChange={setEditing}
        branches={branches}
        initial={{
          id: e.id,
          branchId: e.branchId,
          title: e.title,
          description: e.description,
          startsAt: toLocal(e.startsAt),
          endsAt: e.endsAt ? toLocal(e.endsAt) : null,
          venue: e.venue,
          capacity: e.capacity,
          closesAt: e.closesAt ? toLocal(e.closesAt) : null,
          askPhone: e.askPhone,
          tickets: e.types.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name, price: String(t.priceKobo / 100), capacity: t.capacity ? String(t.capacity) : "" })),
        }}
      />
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        {confirmCancel && (
          <DialogContent
            title="Cancel this event?"
            footer={
              <>
                <Button onClick={() => setConfirmCancel(false)}>Keep it</Button>
                <Button variant="danger" loading={st.pending} onClick={() => st.run({ id: e.id, status: "cancelled" })}>
                  <Ban /> Cancel event
                </Button>
              </>
            }
          >
            <p className="text-[13px] text-muted">
              Everyone registered is emailed. {revenue ? `${naira(revenue)} was paid online: refund it from Paystack.` : ""} This can&apos;t be undone.
            </p>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
