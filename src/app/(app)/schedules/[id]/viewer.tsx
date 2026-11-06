import Link from "next/link";
import { ArrowLeft, Clock, FileText, MapPin, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Note } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { itemClock, to12 } from "@/lib/schedule";
import type { ScheduleSnapshot } from "@/server/db/schema";
import { TYPES } from "../labels";

/** What everyone else sees: the latest published version, without private notes. */
export function ScheduleViewer({
  s,
}: {
  s: { id: string; status: string; currentVersion: number; lastPublishedAt: Date | null; published: ScheduleSnapshot | null };
}) {
  const p = s.published!;
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/schedules">
            <ArrowLeft /> Schedules
          </Link>
        </Button>
      </div>
      <ScheduleDocument snap={p} />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="primary">
          <a href={`/schedules/${s.id}/pdf`} target="_blank" rel="noopener">
            <FileText /> Download PDF
          </a>
        </Button>
        <span className="text-xs text-muted">
          Version {s.currentVersion}
          {s.lastPublishedAt ? `, published ${formatDateTime(s.lastPublishedAt)}` : ""}
        </span>
        {s.status === "completed" && <Badge>Completed</Badge>}
      </div>
    </>
  );
}

export function ScheduleDocument({ snap: p, church }: { snap: ScheduleSnapshot; church?: string }) {
  const clock = itemClock(p.startTime, p.items);
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div>
          {church && <div className="mb-2 border-b-2 border-accent pb-2 text-sm font-semibold">{church}</div>}
          <div className="text-xs font-semibold tracking-wider text-accent uppercase">{p.typeLabel || TYPES[p.serviceType]}</div>
          <h1 className="text-[22px] font-semibold">{p.title}</h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" /> {formatDate(p.serviceDate, "long")}, {to12(p.startTime)}
              {p.endTime ? ` – ${to12(p.endTime)}` : ""}
            </span>
            {p.venue && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" /> {p.venue}
              </span>
            )}
            {p.presidingName && (
              <span className="flex items-center gap-1.5">
                <UserRound className="size-4" /> Presiding: {p.presidingName}
              </span>
            )}
          </div>
          {(p.theme || p.scripture) && (
            <p className="mt-2 text-[13px]">
              {p.theme && <span className="italic">“{p.theme}”</span>}
              {p.scripture && <span className="text-muted"> · {p.scripture}</span>}
            </p>
          )}
        </div>
        <ol className="flex flex-col divide-y divide-line border-y border-line">
          {p.items.map((it, i) => (
            <li key={it.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-2.5 text-[13px] max-sm:grid-cols-[60px_minmax(0,1fr)]">
              <span className="tabular font-semibold">
                {to12(clock[i]!.start)}
                {it.durationMin ? <span className="block text-xs font-normal text-faint">{it.durationMin} min</span> : null}
              </span>
              <span>
                <span className="font-medium">{it.title}</span>
                {it.assignees.length > 0 && (
                  <span className="block text-muted">
                    {it.assignees.map((a) => `${a.name}${a.responsibility ? ` (${a.responsibility})` : ""}`).join(", ")}
                  </span>
                )}
                {it.description && <span className="block text-xs text-muted">{it.description}</span>}
                {it.custom.map((c, k) => (
                  <span key={k} className="block text-xs text-muted">
                    {c.label}: {c.value}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        {p.announcements && <Note>{p.announcements}</Note>}
      </CardBody>
    </Card>
  );
}
