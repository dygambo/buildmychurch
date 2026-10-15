"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarPlus, Plus, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction, formToObject } from "@/components/ui/use-action";
import { MonthlyBars } from "@/components/charts";
import { formatDate, formatTime } from "@/lib/format";
import { archiveTemplateAction, createServiceAction, saveTemplateAction, startTodayAction } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const KIND_LABEL: Record<string, string> = {
  sunday: "Sunday service",
  midweek: "Midweek service",
  special: "Special service",
  vigil: "Vigil",
  youth: "Youth service",
  children: "Children's service",
  other: "Other",
};

type Service = {
  id: string;
  name: string;
  kind: string;
  date: string;
  startsAt: string;
  status: string;
  branchName: string;
  men: number | null;
  women: number | null;
  children: number | null;
  online: number | null;
  present: number;
};
type Template = {
  id: string;
  name: string;
  kind: string;
  weekday: number;
  startTime: string;
  durationMin: number;
  branchId: string;
};

export function AttendanceView({
  today,
  todayTemplates,
  services,
  templates,
  trend,
  branches,
  canRecord,
  canRead,
}: {
  today: string;
  todayTemplates: number;
  services: Service[];
  templates: Template[];
  trend: { date: string; value: number }[];
  branches: { id: string; name: string }[];
  canRecord: boolean;
  canRead: boolean;
}) {
  const router = useRouter();
  const [newService, setNewService] = useState(false);
  const [newTemplate, setNewTemplate] = useState(false);
  const start = useAction(startTodayAction, {
    onSuccess: (ids) => ids.length === 1 && router.push(`/attendance/${ids[0]}`),
  });
  const removeT = useAction(archiveTemplateAction);
  const todays = services.filter((s) => s.date === today);
  const total = (s: Service) => (s.men ?? 0) + (s.women ?? 0) + (s.children ?? 0) || null;
  const last = trend.at(-1)?.value ?? 0;
  const avg = trend.length
    ? Math.round(trend.slice(-4).reduce((a, t) => a + t.value, 0) / Math.min(4, trend.length))
    : 0;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Check people in at services, or record the ushers' headcount."
        actions={
          canRecord && (
            <>
              <Button onClick={() => setNewService(true)}>
                <CalendarPlus /> One-off service
              </Button>
              {todayTemplates > 0 && (
                <Button variant="primary" loading={start.pending} onClick={() => start.run({})}>
                  <CalendarCheck /> Start today&apos;s services
                </Button>
              )}
            </>
          )
        }
      />

      {canRead && trend.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 max-lg:grid-cols-1">
          <div className="grid grid-cols-1 gap-3 max-lg:grid-cols-2">
            <Stat
              label="Last Sunday"
              value={last.toLocaleString("en-NG")}
              sub="Headcount, or check-ins where no count was taken"
            />
            <Stat label="4-week average" value={avg.toLocaleString("en-NG")} />
          </div>
          <Card>
            <CardHeader title="Sunday attendance, last 12 weeks" />
            <CardBody>
              <MonthlyBars
                name="Attendance"
                height={180}
                data={trend.map((t) => ({ label: formatDate(t.date, "short"), value: t.value }))}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {todays.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {todays.map((s) => (
            <Link
              key={s.id}
              href={`/attendance/${s.id}`}
              className="flex flex-col gap-2 rounded-2xl border border-accent-line bg-accent-soft p-4 hover:brightness-[.98]"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold">{s.name}</span>
                <Badge tone={s.status === "open" ? "good" : "neutral"} className="ml-auto">
                  {s.status === "open" ? "Open" : "Closed"}
                </Badge>
              </div>
              <div className="text-[13px] text-muted">
                Today, {formatTime(s.startsAt)}
                {branches.length > 1 && ` · ${s.branchName}`}
              </div>
              <div className="text-[13px]">
                <b>{s.present}</b> checked in
                {total(s) != null && (
                  <>
                    {" "}
                    · headcount <b>{total(s)}</b>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader title="Recent services" />
          {services.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck />}
              title="No services yet"
              action={
                canRecord && (
                  <Button variant="primary" onClick={() => (templates.length ? start.run({}) : setNewTemplate(true))}>
                    <Plus /> {templates.length ? "Start today's services" : "Set up your regular services"}
                  </Button>
                )
              }
            >
              Add your regular services once (for example Sunday 8am and Wednesday 6pm). Each week, one tap creates them
              ready for check-in.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Service</Th>
                  <Th num>Checked in</Th>
                  <Th num className="max-sm:hidden">
                    Headcount
                  </Th>
                  <Th num className="max-md:hidden">
                    Online
                  </Th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <Tr key={s.id} className="cursor-pointer" onClick={() => router.push(`/attendance/${s.id}`)}>
                    <Td>
                      <Link
                        href={`/attendance/${s.id}`}
                        className="font-medium hover:text-accent"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.name}
                      </Link>
                      <div className="text-xs text-faint">
                        {formatDate(s.date, "week")} · {formatTime(s.startsAt)}
                        {branches.length > 1 && ` · ${s.branchName}`}
                      </div>
                    </Td>
                    <Td num>{s.present.toLocaleString("en-NG")}</Td>
                    <Td num className="max-sm:hidden">
                      {total(s)?.toLocaleString("en-NG") ?? <span className="text-faint">—</span>}
                    </Td>
                    <Td num className="max-md:hidden">
                      {s.online?.toLocaleString("en-NG") ?? <span className="text-faint">—</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Repeat className="size-4" /> Regular services
              </span>
            }
            action={
              canRecord && (
                <Button size="sm" variant="ghost" onClick={() => setNewTemplate(true)}>
                  <Plus /> Add
                </Button>
              )
            }
          />
          <CardBody>
            {templates.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {templates.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-2 text-[13px] first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-faint">
                        {DAYS[t.weekday]}s at {t.startTime} · {KIND_LABEL[t.kind]}
                      </div>
                    </div>
                    {canRecord && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${t.name}`}
                        onClick={() => removeT.run({ id: t.id })}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">None yet. Add the services you hold every week.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <ServiceDialog open={newService} onOpenChange={setNewService} branches={branches} today={today} />
      <TemplateDialog open={newTemplate} onOpenChange={setNewTemplate} branches={branches} />
    </>
  );
}

function ServiceDialog({
  open,
  onOpenChange,
  branches,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branches: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const save = useAction(createServiceAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      router.push(`/attendance/${d.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="One-off service"
          description="For special services, programmes and vigils."
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="svc-form" loading={save.pending}>
                Create
              </Button>
            </>
          }
        >
          <form
            id="svc-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              save.run(formToObject(e.currentTarget) as Parameters<typeof createServiceAction>[0]);
            }}
          >
            <Field label="Name" htmlFor="s-name" error={save.fieldErrors.name} className="col-span-full">
              <Input id="s-name" name="name" required placeholder="e.g. Thanksgiving Service" />
            </Field>
            <Field label="Type" htmlFor="s-kind">
              <Select id="s-kind" name="kind" defaultValue="special">
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <BranchField branches={branches} />
            <Field label="Date" htmlFor="s-date">
              <Input id="s-date" name="date" type="date" required defaultValue={today} />
            </Field>
            <Field label="Starts" htmlFor="s-time">
              <Input id="s-time" name="startTime" type="time" required defaultValue="09:00" />
            </Field>
            <Field label="Length (minutes)" htmlFor="s-dur">
              <Input id="s-dur" name="durationMin" type="number" min={15} defaultValue={120} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  branches,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branches: { id: string; name: string }[];
}) {
  const save = useAction(saveTemplateAction, { onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="Add a regular service"
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="tpl-form" loading={save.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="tpl-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              save.run(formToObject(e.currentTarget) as Parameters<typeof saveTemplateAction>[0]);
            }}
          >
            <Field label="Name" htmlFor="t-name" error={save.fieldErrors.name} className="col-span-full">
              <Input id="t-name" name="name" required placeholder="e.g. Sunday First Service" />
            </Field>
            <Field label="Day" htmlFor="t-day">
              <Select id="t-day" name="weekday" defaultValue="0">
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Starts" htmlFor="t-time">
              <Input id="t-time" name="startTime" type="time" required defaultValue="08:00" />
            </Field>
            <Field label="Type" htmlFor="t-kind">
              <Select id="t-kind" name="kind" defaultValue="sunday">
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Length (minutes)" htmlFor="t-dur">
              <Input id="t-dur" name="durationMin" type="number" min={15} defaultValue={120} />
            </Field>
            <BranchField branches={branches} />
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function BranchField({ branches }: { branches: { id: string; name: string }[] }) {
  if (branches.length <= 1) return <input type="hidden" name="branchId" value={branches[0]?.id} />;
  return (
    <Field label="Branch" htmlFor="x-branch">
      <Select id="x-branch" name="branchId" defaultValue={branches[0]?.id}>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
