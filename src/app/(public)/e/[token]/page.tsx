import type { Metadata } from "next";
import { CalendarDays, MapPin } from "lucide-react";
import { Card, CardBody, Note } from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/format";
import { publicEvent } from "@/server/services/events";
import { RegisterForm } from "./form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const e = await publicEvent((await params).token);
  return { title: e ? `${e.event.title} · ${e.church}` : "Event" };
}

export default async function PublicEventPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const e = await publicEvent(token);
  if (!e)
    return (
      <Card className="w-full max-w-md">
        <CardBody className="text-[13px] text-muted">This event link isn&apos;t valid. Ask the church for the right one.</CardBody>
      </Card>
    );
  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="text-center">
        <div className="text-[13px] font-medium text-accent">{e.church}</div>
        <h1 className="mt-1 text-2xl font-semibold text-balance">{e.event.title}</h1>
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4" /> {formatDate(e.event.startsAt, "long")}, {formatTime(e.event.startsAt)}
            {e.event.endsAt ? ` – ${formatTime(e.event.endsAt)}` : ""}
          </span>
          {e.event.venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" /> {e.event.venue}
            </span>
          )}
        </div>
      </div>
      {e.event.description && (
        <Card>
          <CardBody className="text-[14px] leading-relaxed whitespace-pre-wrap">{e.event.description}</CardBody>
        </Card>
      )}
      {e.closed ? (
        <Note tone={e.event.status === "cancelled" ? "bad" : "warn"}>{e.closedReason}</Note>
      ) : (
        <RegisterForm token={token} types={e.types} askPhone={e.event.askPhone} testMode={e.testMode} left={e.left} />
      )}
    </div>
  );
}
