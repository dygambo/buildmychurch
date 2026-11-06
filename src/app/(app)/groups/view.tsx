"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Crown, Home, MapPin, Plus, Users, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { useAction, formToObject } from "@/components/ui/use-action";
import { saveGroupAction } from "./actions";

export const KIND = {
  department: { one: "department", label: "Departments", icon: UsersRound, hint: "Choir, ushering, media, protocol…" },
  cell: { one: "home cell", label: "Home cells", icon: Home, hint: "Small groups that meet in homes during the week." },
  ministry: { one: "ministry", label: "Ministries", icon: Users, hint: "Men, women, youth, singles, couples…" },
} as const;
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type GroupRow = {
  id: string;
  name: string;
  kind: "department" | "cell" | "ministry";
  description: string | null;
  branchId: string;
  branchName: string;
  leaderName: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  location: string | null;
  area: string | null;
  archived: boolean;
  size: number;
};

export function GroupsView({
  kind,
  showArchived,
  groups,
  branches,
  canManage,
}: {
  kind: GroupRow["kind"];
  showArchived: boolean;
  groups: GroupRow[];
  branches: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const k = KIND[kind];
  const shown = groups.filter((g) => g.kind === kind && g.archived === showArchived);
  const count = (x: GroupRow["kind"]) => groups.filter((g) => g.kind === x && !g.archived).length;
  const archivedCount = groups.filter((g) => g.kind === kind && g.archived).length;
  return (
    <>
      <PageHeader
        title="Groups & cells"
        description="Departments, home cells and ministries. Leaders and members are linked to member records."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> Add {k.one}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <LinkTabs
          current={kind}
          tabs={(Object.keys(KIND) as GroupRow["kind"][]).map((x) => ({
            key: x,
            label: KIND[x].label,
            href: `/groups?kind=${x}`,
            count: count(x),
          }))}
        />
        {(archivedCount > 0 || showArchived) && (
          <Link
            href={showArchived ? `/groups?kind=${kind}` : `/groups?kind=${kind}&archived=1`}
            className="ml-auto text-[13px] text-muted hover:text-fg"
          >
            {showArchived ? "Show active" : `Archived (${archivedCount})`}
          </Link>
        )}
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<k.icon />}
            title={showArchived ? `No archived ${k.label.toLowerCase()}` : `No ${k.label.toLowerCase()} yet`}
            action={
              canManage &&
              !showArchived && (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus /> Add {k.one}
                </Button>
              )
            }
          >
            {k.hint}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {shown.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-accent-line"
            >
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <k.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.name}</div>
                  <div className="text-xs text-faint">
                    {g.size} {g.size === 1 ? "person" : "people"}
                    {branches.length > 1 && ` · ${g.branchName}`}
                  </div>
                </div>
                {g.archived && <Badge>Archived</Badge>}
              </div>
              <div className="flex flex-col gap-1 text-[12.5px] text-muted">
                <span className="flex items-center gap-1.5">
                  <Crown className="size-3.5" /> {g.leaderName ?? <span className="text-faint">No leader yet</span>}
                </span>
                {g.meetingDay && (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" /> {g.meetingDay}s{g.meetingTime && `, ${g.meetingTime}`}
                  </span>
                )}
                {(g.location || g.area) && (
                  <span className="flex items-center gap-1.5 truncate">
                    <MapPin className="size-3.5 shrink-0" /> {[g.location, g.area].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <GroupDialog open={adding} onOpenChange={setAdding} kind={kind} branches={branches} />
    </>
  );
}

export function GroupDialog({
  open,
  onOpenChange,
  kind,
  branches,
  group,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: GroupRow["kind"];
  branches: { id: string; name: string }[];
  group?: GroupRow;
}) {
  const router = useRouter();
  const [k, setK] = useState<GroupRow["kind"]>(group?.kind ?? kind);
  const save = useAction(saveGroupAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      if (!group) router.push(`/groups/${d.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={group ? `Edit ${group.name}` : `Add a ${KIND[k].one}`}
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="group-form" loading={save.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="group-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              save.run({ ...(formToObject(e.currentTarget) as Parameters<typeof saveGroupAction>[0]), id: group?.id });
            }}
          >
            <Field label="Type" htmlFor="g-kind">
              <Select id="g-kind" name="kind" value={k} onChange={(e) => setK(e.target.value as GroupRow["kind"])}>
                <option value="department">Department</option>
                <option value="cell">Home cell</option>
                <option value="ministry">Ministry</option>
              </Select>
            </Field>
            <Field label="Branch" htmlFor="g-branch">
              <Select id="g-branch" name="branchId" defaultValue={group?.branchId ?? branches[0]?.id}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="g-name" error={save.fieldErrors.name} className="col-span-full">
              <Input
                id="g-name"
                name="name"
                required
                defaultValue={group?.name}
                placeholder={
                  k === "cell" ? "e.g. Gwarinpa Cell" : k === "department" ? "e.g. Choir" : "e.g. Youth Church"
                }
              />
            </Field>
            <Field label="Meets on" htmlFor="g-day" optional>
              <Select id="g-day" name="meetingDay" defaultValue={group?.meetingDay ?? ""}>
                <option value="">—</option>
                {DAYS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <Field label="Time" htmlFor="g-time" optional>
              <Input id="g-time" name="meetingTime" type="time" defaultValue={group?.meetingTime ?? ""} />
            </Field>
            <Field
              label="Where"
              htmlFor="g-loc"
              optional
              hint={k === "cell" ? "Host's address or landmark" : undefined}
            >
              <Input id="g-loc" name="location" defaultValue={group?.location ?? ""} />
            </Field>
            <Field label="Area" htmlFor="g-area" optional>
              <Input id="g-area" name="area" defaultValue={group?.area ?? ""} />
            </Field>
            <Field label="About" htmlFor="g-desc" optional className="col-span-full">
              <Textarea id="g-desc" name="description" rows={2} defaultValue={group?.description ?? ""} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
