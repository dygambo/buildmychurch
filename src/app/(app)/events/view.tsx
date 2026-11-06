"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, MapPin, Ticket, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { formatDate, formatTime, naira } from "@/lib/format";
import type { EventRow } from "@/server/services/events";
import { EventDialog } from "./event-dialog";

export const EVENT_STATUS = {
  draft: { label: "Draft", tone: "warn" as const },
  published: { label: "Registration open", tone: "good" as const },
  cancelled: { label: "Cancelled", tone: "bad" as const },
};

export function EventsView({ events, when, branches }: { events: EventRow[]; when: "upcoming" | "past"; branches: { id: string; name: string }[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Events"
        description="Conferences, retreats, concerts and outreaches, with a registration page, tickets and check-in at the door."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <CalendarPlus /> New event
          </Button>
        }
      />
      <LinkTabs
        className="self-start"
        current={when}
        tabs={[
          { key: "upcoming", label: "Upcoming", href: "/events" },
          { key: "past", label: "Past", href: "/events?when=past" },
        ]}
      />
      {events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Ticket />}
            title={when === "past" ? "No past events" : "No upcoming events"}
            action={
              when === "upcoming" && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <CalendarPlus /> Plan an event
                </Button>
              )
            }
          >
            Share a registration link and QR code, sell tickets online, and check people in with their phone.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {events.map((e) => {
            const st = EVENT_STATUS[e.status];
            return (
              <Link key={e.id} href={`/events/${e.id}`} className="group flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <div className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-center text-accent">
                    <div className="text-[10px] font-semibold uppercase">{formatDate(e.startsAt, "short").split(" ")[1]}</div>
                    <div className="text-lg leading-none font-bold">{formatDate(e.startsAt, "short").split(" ")[0]}</div>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div className="line-clamp-2 font-semibold group-hover:text-accent">{e.title}</div>
                <div className="flex flex-col gap-1 text-xs text-muted">
                  <span>
                    {formatDate(e.startsAt, "week")}, {formatTime(e.startsAt)}
                  </span>
                  {e.venue && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" /> {e.venue}
                    </span>
                  )}
                </div>
                <div className="mt-auto flex items-center gap-3 border-t border-line pt-2 text-xs">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5 text-faint" /> {e.tickets}
                    {e.capacity ? ` / ${e.capacity}` : ""} registered
                  </span>
                  {e.revenue > 0 && <span className="text-good">{naira(e.revenue, { compact: true })}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <EventDialog open={creating} onOpenChange={setCreating} branches={branches} />
    </>
  );
}
