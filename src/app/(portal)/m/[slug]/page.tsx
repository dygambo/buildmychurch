import Link from "next/link";
import { CalendarDays, HandHeart, HandCoins, Ticket, UsersRound } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate, formatTime, naira } from "@/lib/format";
import { to12 } from "@/lib/schedule";
import { portalHome } from "@/server/services/portal";
import { requireMember } from "./session";
import { SignOut } from "./sign-out";

const SLOT: Record<string, string> = { assigned: "Please confirm", confirmed: "Confirmed", declined: "You said you can't make it", open: "" };

export default async function PortalHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { church, me } = await requireMember(slug);
  const h = await portalHome(church, me);
  const serving = h.slots.length + h.parts.length;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Hello, {me.firstName}</h1>
        <p className="text-[13px] text-muted">{serving ? `You're serving ${serving === 1 ? "once" : `${serving} times`} in the coming weeks.` : "Here's what's coming up."}</p>
      </div>
      {(h.slots.length > 0 || h.parts.length > 0) && (
        <Card>
          <CardHeader title="Where you're serving" />
          <ul className="flex flex-col" data-testid="serving">
            {h.parts.map((p, i) => (
              <li key={`p${i}`} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                <CalendarDays className="size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="font-medium">
                    {p.item}
                    {p.responsibility ? ` (${p.responsibility})` : ""}
                  </div>
                  <div className="text-xs text-muted">
                    {p.title} · {formatDate(p.serviceDate, "week")}, {to12(p.startTime)}
                  </div>
                </div>
              </li>
            ))}
            {h.slots.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                <UsersRound className="size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="font-medium">
                    {s.groupName}: {s.position}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(s.date, "week")} · {s.serviceLabel}
                  </div>
                </div>
                <Link href={s.respondUrl} className={s.status === "assigned" ? "rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink" : "text-xs text-muted"}>
                  {s.status === "assigned" ? "Confirm" : SLOT[s.status]}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/m/${slug}/giving`} className="rounded-xl border border-line bg-surface p-4 hover:border-accent">
          <HandCoins className="size-5 text-accent" />
          <div className="mt-2 text-xs text-muted">Your giving this year</div>
          <div className="text-lg font-semibold tabular">{naira(h.givingYear)}</div>
        </Link>
        <Link href={`/m/${slug}/prayer`} className="rounded-xl border border-line bg-surface p-4 hover:border-accent">
          <HandHeart className="size-5 text-accent" />
          <div className="mt-2 text-xs text-muted">Need prayer?</div>
          <div className="text-[14px] font-semibold">Send a request</div>
        </Link>
      </div>
      {h.tickets.length > 0 && (
        <Card>
          <CardHeader title="Your tickets" />
          <ul className="flex flex-col">
            {h.tickets.map((t) => (
              <li key={t.code} className="border-t border-line first:border-t-0">
                <Link href={t.url} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <Ticket className="size-4 text-accent" />
                  <div className="flex-1 text-[13px]">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted">
                      {formatDate(t.startsAt, "week")}, {formatTime(t.startsAt)} · {t.quantity} {t.quantity === 1 ? "ticket" : "tickets"}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {h.events.length > 0 && (
        <Card>
          <CardHeader title="Coming up at church" />
          <ul className="flex flex-col">
            {h.events.map((e) => (
              <li key={e.id} className="border-t border-line first:border-t-0">
                <Link href={e.url} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="w-11 shrink-0 rounded-lg bg-accent-soft py-1 text-center text-accent">
                    <div className="text-[10px] font-semibold uppercase">{formatDate(e.startsAt, "short").split(" ")[1]}</div>
                    <div className="text-base leading-none font-bold">{formatDate(e.startsAt, "short").split(" ")[0]}</div>
                  </div>
                  <div className="flex-1 text-[13px]">
                    <div className="font-medium">{e.title}</div>
                    <div className="text-xs text-muted">
                      {formatTime(e.startsAt)}
                      {e.venue ? ` · ${e.venue}` : ""}
                    </div>
                  </div>
                  <span className="text-xs text-accent">Register</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {h.groups.length > 0 && (
        <Card>
          <CardHeader title="Your groups" />
          <CardBody className="flex flex-wrap gap-2">
            {h.groups.map((g) => (
              <span key={g.name} className="rounded-full bg-surface-2 px-3 py-1 text-[13px]">
                {g.name}
                {g.role !== "member" && <span className="text-xs text-muted"> · {g.role === "leader" ? "Leader" : "Assistant"}</span>}
              </span>
            ))}
          </CardBody>
        </Card>
      )}
      <SignOut slug={slug} />
    </>
  );
}
