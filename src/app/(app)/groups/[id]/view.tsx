"use client";
import { useState } from "react";
import Link from "next/link";
import { Archive, ArrowLeft, CalendarDays, MapPin, Pencil, RotateCcw, UserPlus, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Person } from "@/components/ui/avatar";
import { useAction } from "@/components/ui/use-action";
import { formatDate, fullName } from "@/lib/format";
import { MemberPicker } from "../../members/member-picker";
import { addToGroupAction, archiveGroupAction, removeFromGroupAction, setGroupRoleAction } from "../actions";
import { GroupDialog, KIND, type GroupRow } from "../view";

type P = {
  id: string;
  title: string | null;
  firstName: string;
  lastName: string;
  memberNo: string;
  role: string;
  joinedAt: string;
};

export function GroupDetail({
  group,
  branches,
  canManage,
  canSeeMembers,
}: {
  group: GroupRow & { people: P[] };
  branches: { id: string; name: string }[];
  canManage: boolean;
  canSeeMembers: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const add = useAction(addToGroupAction);
  const remove = useAction(removeFromGroupAction);
  const role = useAction(setGroupRoleAction);
  const archive = useAction(archiveGroupAction);
  const k = KIND[group.kind];
  return (
    <>
      <Link
        href={`/groups?kind=${group.kind}`}
        className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> {k.label}
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {group.name} {group.archived && <Badge>Archived</Badge>}
          </span>
        }
        description={group.description ?? `${k.one[0]!.toUpperCase()}${k.one.slice(1)} · ${group.branchName}`}
        actions={
          canManage && (
            <>
              <Button
                onClick={() => archive.run({ id: group.id, archived: !group.archived })}
                loading={archive.pending}
              >
                {group.archived ? <RotateCcw /> : <Archive />} {group.archived ? "Restore" : "Archive"}
              </Button>
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader
            title={`${group.people.length} ${group.people.length === 1 ? "person" : "people"}`}
            action={
              canSeeMembers &&
              group.people.length > 0 && (
                <Link href={`/members?group=${group.id}`} className="text-[13px] text-accent">
                  Open in members list
                </Link>
              )
            }
          />
          {canManage && !group.archived && (
            <div className="border-b border-line px-4 pb-3">
              <MemberPicker
                placeholder="Add someone: search by name, phone or member number"
                exclude={group.people.map((p) => p.id)}
                onPick={(m) => add.run({ groupId: group.id, memberIds: [m.id] })}
              />
            </div>
          )}
          {group.people.length === 0 ? (
            <EmptyState icon={<Users />} title="No one here yet">
              {canManage ? "Search above to add people. The first leader you choose is shown on the group card." : null}
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th className="max-sm:hidden">Since</Th>
                  {canManage && <Th />}
                </tr>
              </thead>
              <tbody>
                {group.people.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      {canSeeMembers ? (
                        <Link href={`/members/${p.id}`} className="block hover:text-accent">
                          <Person name={fullName(p)} sub={p.memberNo} size="sm" />
                        </Link>
                      ) : (
                        <Person name={fullName(p)} size="sm" />
                      )}
                    </Td>
                    <Td>
                      {canManage ? (
                        <Select
                          aria-label={`Role of ${p.firstName}`}
                          className="h-8 w-32"
                          value={p.role}
                          onChange={(e) =>
                            role.run({ groupId: group.id, memberId: p.id, role: e.target.value as "member" })
                          }
                        >
                          <option value="leader">Leader</option>
                          <option value="assistant">Assistant</option>
                          <option value="member">Member</option>
                        </Select>
                      ) : p.role === "member" ? (
                        "Member"
                      ) : (
                        <Badge tone="accent">{p.role === "leader" ? "Leader" : "Assistant"}</Badge>
                      )}
                    </Td>
                    <Td className="text-muted max-sm:hidden">{formatDate(p.joinedAt)}</Td>
                    {canManage && (
                      <Td className="text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${p.firstName} from ${group.name}`}
                          onClick={() => remove.run({ groupId: group.id, memberId: p.id })}
                        >
                          <X />
                        </Button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Meeting" />
          <CardBody className="flex flex-col gap-2 text-[13px]">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4 text-faint" />
              {group.meetingDay ? (
                `${group.meetingDay}s${group.meetingTime ? `, ${group.meetingTime}` : ""}`
              ) : (
                <span className="text-muted">No regular day set</span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <MapPin className="size-4 text-faint" />
              {group.location || group.area ? (
                [group.location, group.area].filter(Boolean).join(", ")
              ) : (
                <span className="text-muted">No location set</span>
              )}
            </span>
            {canManage && !group.people.length && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
                <UserPlus className="size-3.5" /> Tip: add people from the member list in bulk with “Add to group”.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
      <GroupDialog open={editing} onOpenChange={setEditing} kind={group.kind} branches={branches} group={group} />
    </>
  );
}
