"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarDays, Clock, Download, MapPin, Plus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBox } from "@/components/ui/search-box";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { to12 } from "@/lib/schedule";
import type { ScheduleFilters, ScheduleRow } from "@/server/services/schedules";
import { statusOf, TYPES } from "./labels";
import { NewScheduleDialog } from "./new-dialog";

type Upcoming = {
  id: string;
  title: string;
  serviceType: string;
  typeLabel: string | null;
  serviceDate: string;
  startTime: string;
  venue: string | null;
  status: string;
  currentVersion: number;
  hasChanges: boolean;
  presidingName: string | null;
};

export function SchedulesView({
  list,
  upcoming,
  mine,
  templates,
  branches,
  filters,
  canManage,
  openNew,
}: {
  list: { rows: ScheduleRow[]; total: number; page: number; pageSize: number };
  upcoming: Upcoming[];
  mine: { id: string; title: string; serviceDate: string; startTime: string; item: string }[];
  templates: { id: string; name: string; serviceType: string; items: number }[];
  branches: { id: string; name: string }[];
  filters: ScheduleFilters;
  canManage: boolean;
  openNew: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [creating, setCreating] = useState(openNew);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const href = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  const filtered = Boolean(filters.q || filters.from || filters.to || filters.type || filters.person || filters.venue);
  return (
    <>
      <PageHeader
        title="Service schedules"
        description="The order of service for every service: who ministers, when. Publishing sends each person their part and a PDF."
        actions={
          canManage && (
            <>
              <Button asChild variant="ghost" className="max-sm:hidden">
                <a href={`/schedules/export?${new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== "page") as [string, string][])}`}>
                  <Download /> Export
                </a>
              </Button>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus /> New schedule
              </Button>
            </>
          )
        }
      />

      {mine.length > 0 && (
        <Card>
          <CardHeader title="Your parts" />
          <CardBody className="flex flex-wrap gap-2">
            {mine.map((m) => (
              <Link
                key={`${m.id}-${m.item}`}
                href={`/schedules/${m.id}`}
                className="rounded-lg border border-line px-3 py-2 text-[13px] hover:border-accent hover:bg-accent-soft"
              >
                <div className="font-medium">{m.item}</div>
                <div className="text-xs text-muted">
                  {m.title} · {formatDate(m.serviceDate, "week")}, {to12(m.startTime)}
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      {upcoming.length > 0 && (
        <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
          {upcoming.map((u) => {
            const st = statusOf(u);
            return (
              <Link key={u.id} href={`/schedules/${u.id}`} className="group rounded-xl border border-line bg-surface p-4 transition hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold tracking-wide text-accent uppercase">{formatDate(u.serviceDate, "week")}</div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div className="mt-1 line-clamp-2 font-semibold group-hover:text-accent">{u.title}</div>
                <div className="mt-2 flex flex-col gap-1 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5" /> {to12(u.startTime)}
                  </span>
                  {u.venue && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="size-3.5" /> {u.venue}
                    </span>
                  )}
                  {u.presidingName && (
                    <span className="flex items-center gap-1.5">
                      <UserRound className="size-3.5" /> {u.presidingName}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <LinkTabs
        className="self-start"
        current={filters.status ?? "current"}
        tabs={[
          { key: "current", label: "All current", href: href("status", "") },
          ...(canManage ? [{ key: "draft", label: "Drafts", href: href("status", "draft") }] : []),
          { key: "published", label: "Published", href: href("status", "published") },
          { key: "updated", label: "Updated", href: href("status", "updated") },
          { key: "completed", label: "Completed", href: href("status", "completed") },
          { key: "archived", label: "Archived", href: href("status", "archived") },
        ]}
      />
      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchBox placeholder="Title or theme" className="w-56 max-sm:w-full" />
        <Field label="From" htmlFor="s-from">
          <Input id="s-from" type="date" defaultValue={filters.from} onChange={(e) => setParam("from", e.target.value)} />
        </Field>
        <Field label="To" htmlFor="s-to">
          <Input id="s-to" type="date" defaultValue={filters.to} onChange={(e) => setParam("to", e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="s-type">
          <Select id="s-type" value={filters.type ?? ""} onChange={(e) => setParam("type", e.target.value)}>
            <option value="">Any type</option>
            {Object.entries(TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {k === "custom" ? "Other" : l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minister or participant" htmlFor="s-person">
          <Input id="s-person" defaultValue={filters.person} placeholder="Name" onBlur={(e) => setParam("person", e.target.value)} onKeyDown={(e) => e.key === "Enter" && setParam("person", e.currentTarget.value)} />
        </Field>
        <Field label="Venue" htmlFor="s-venue">
          <Input id="s-venue" defaultValue={filters.venue} onBlur={(e) => setParam("venue", e.target.value)} onKeyDown={(e) => e.key === "Enter" && setParam("venue", e.currentTarget.value)} />
        </Field>
        {filtered && (
          <Button variant="ghost" onClick={() => router.replace(filters.status ? `${path}?status=${filters.status}` : path)}>
            Clear
          </Button>
        )}
      </Card>

      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title={filtered || filters.status ? "No schedules match" : "No schedules yet"}
            action={
              canManage &&
              !filtered && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus /> Plan your next service
                </Button>
              )
            }
          >
            {filtered || filters.status
              ? "Try a wider date range or clear the filters."
              : canManage
                ? "Start from a ready-made Sunday, midweek, communion, wedding or funeral template, or from scratch."
                : "Published schedules appear here."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Service</Th>
                <Th className="max-lg:hidden">Venue</Th>
                <Th className="max-md:hidden">People</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => {
                const st = statusOf(r);
                return (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      {formatDate(r.serviceDate, "week")}
                      <div className="text-xs text-faint">{to12(r.startTime)}</div>
                    </Td>
                    <Td>
                      <Link href={`/schedules/${r.id}`} className="font-medium hover:text-accent">
                        {r.title}
                      </Link>
                      <div className="text-xs text-muted">
                        {r.typeLabel || TYPES[r.serviceType]}
                        {r.presidingName ? ` · ${r.presidingName}` : ""}
                        {branches.length > 1 ? ` · ${r.branchName}` : ""}
                      </div>
                    </Td>
                    <Td className="text-muted max-lg:hidden">{r.venue ?? "—"}</Td>
                    <Td className="text-muted max-md:hidden">
                      {r.items} items · {r.people} {r.people === 1 ? "person" : "people"}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {canManage && r.failed > 0 && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-bad">
                          <AlertTriangle className="size-3" /> {r.failed} notification{r.failed === 1 ? "" : "s"} failed
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          hrefFor={(p) => {
            const next = new URLSearchParams(sp.toString());
            next.set("page", String(p));
            return `${path}?${next}`;
          }}
        />
      </Card>
      {canManage && (
        <NewScheduleDialog
          open={creating}
          onOpenChange={setCreating}
          templates={templates}
          recent={list.rows.slice(0, 15).map((r) => ({ id: r.id, title: r.title, serviceDate: r.serviceDate }))}
          branches={branches}
        />
      )}
    </>
  );
}
