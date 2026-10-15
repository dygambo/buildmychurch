import type { Metadata } from "next";
import { CalendarDays, MapPin } from "lucide-react";
import { Card, CardBody, Note } from "@/components/ui/card";
import { QrImage } from "@/components/qr";
import { formatDate, formatTime } from "@/lib/format";
import { publicTicket } from "@/server/services/events";

export const metadata: Metadata = { title: "Your ticket", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ token: string; code: string }> }) {
  const { token, code } = await params;
  const t = await publicTicket(token, code.toUpperCase());
  if (!t)
    return (
      <Card className="w-full max-w-sm">
        <CardBody className="text-[13px] text-muted">This ticket link isn&apos;t valid.</CardBody>
      </Card>
    );
  return (
    <Card className="w-full max-w-sm overflow-hidden">
      <div className="bg-accent px-5 py-4 text-white">
        <div className="text-xs opacity-80">{t.church}</div>
        <h1 className="text-lg leading-tight font-semibold">{t.event.title}</h1>
      </div>
      <CardBody className="flex flex-col items-center gap-3 text-center">
        {t.status === "confirmed" ? (
          <>
            <QrImage value={t.code} size={200} label={`Ticket QR code ${t.code}`} />
            <div className="font-mono text-lg tracking-widest" data-testid="ticket-code">
              {t.code}
            </div>
          </>
        ) : (
          <Note tone="warn">{t.status === "pending" ? "This ticket is waiting for payment." : "This ticket was cancelled."}</Note>
        )}
        <div className="text-[15px] font-semibold">{t.name}</div>
        <div className="text-[13px] text-muted">
          {t.quantity} × {t.ticket}
          {t.checkedIn ? ` · ${t.checkedIn} checked in` : ""}
        </div>
        <div className="flex flex-col gap-1 text-[13px] text-muted">
          <span className="flex items-center justify-center gap-1.5">
            <CalendarDays className="size-4" /> {formatDate(t.event.startsAt, "long")}, {formatTime(t.event.startsAt)}
          </span>
          {t.event.venue && (
            <span className="flex items-center justify-center gap-1.5">
              <MapPin className="size-4" /> {t.event.venue}
            </span>
          )}
        </div>
        {t.event.status === "cancelled" && <Note tone="bad">This event has been cancelled.</Note>}
        <p className="text-xs text-faint">Show this at the entrance. A screenshot works too.</p>
        <a href={`/e/${token}`} className="text-xs text-accent">
          Event page
        </a>
      </CardBody>
    </Card>
  );
}
