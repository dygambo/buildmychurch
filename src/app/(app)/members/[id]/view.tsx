"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, MoreHorizontal, Pencil, Plus, Route, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { leaveFamilyAction, linkFamilyAction, removeMemberAction, setTagsAction } from "../actions";
import { startFollowupAction } from "../../follow-up/actions";
import { MemberDrawer, type MemberFormValues } from "../member-form";
import { MemberPicker, type Picked } from "../member-picker";

export function ProfileActions({
  member,
  branches,
  canSensitive,
}: {
  member: MemberFormValues & { id: string; firstName: string; lastName: string };
  branches: { id: string; name: string }[];
  canSensitive: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const remove = useAction(removeMemberAction, { onSuccess: () => router.push("/members") });
  return (
    <>
      <Button variant="primary" onClick={() => setEditing(true)}>
        <Pencil /> Edit
      </Button>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem danger onSelect={() => setRemoving(true)}>
            <Trash2 /> Remove member
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <MemberDrawer
        open={editing}
        onOpenChange={setEditing}
        id={member.id}
        initial={member}
        branches={branches}
        canSensitive={canSensitive}
      />
      <Dialog open={removing} onOpenChange={setRemoving}>
        {removing && (
          <DialogContent
            title={`Remove ${member.firstName} ${member.lastName}?`}
            footer={
              <>
                <Button onClick={() => setRemoving(false)}>Cancel</Button>
                <Button variant="danger" loading={remove.pending} onClick={() => remove.run({ id: member.id, reason })}>
                  Remove and erase details
                </Button>
              </>
            }
          >
            <p className="text-[13px] text-muted">
              Their phone number, email, address and health details are erased, and they leave every group and family.
              Past giving and attendance totals are kept without their name attached. This can&apos;t be undone.
            </p>
            <p className="text-[13px] text-muted">
              If they have moved to another church or stopped attending, edit their status instead.
            </p>
            <Field label="Reason" htmlFor="rm-reason" error={remove.fieldErrors.reason}>
              <Textarea
                id="rm-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Asked for their data to be deleted"
              />
            </Field>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

export function TagEditor({
  memberId,
  current,
  all,
  canWrite,
}: {
  memberId: string;
  current: string[];
  all: string[];
  canWrite: boolean;
}) {
  const [tags, setTags] = useState(current);
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setTags(current);
  }
  const [text, setText] = useState("");
  const save = useAction(setTagsAction);
  const update = (next: string[]) => {
    setTags(next);
    save.run({ id: memberId, tags: next });
  };
  return (
    <Card>
      <CardHeader title="Tags" />
      <CardBody className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          {tags.length ? (
            tags.map((t) => (
              <Badge key={t} tone="accent">
                {t}
                {canWrite && (
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    className="-mr-1 ml-0.5 rounded hover:bg-accent/10"
                    onClick={() => update(tags.filter((x) => x !== t))}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            ))
          ) : (
            <p className="text-[13px] text-muted">No tags yet. Tags help you group people, like “Choir” or “Youth”.</p>
          )}
        </div>
        {canWrite && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) update([...tags, t]);
              setText("");
            }}
          >
            <Input
              aria-label="New tag"
              list="all-tags"
              placeholder="Add a tag"
              value={text}
              maxLength={40}
              onChange={(e) => setText(e.target.value)}
            />
            <datalist id="all-tags">
              {all
                .filter((a) => !tags.includes(a))
                .map((a) => (
                  <option key={a} value={a} />
                ))}
            </datalist>
            <Button type="submit" loading={save.pending}>
              Add
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

const ROLE_LABEL: Record<string, string> = { head: "Head", spouse: "Spouse", child: "Child", relative: "Relative" };

export function FamilyCard({
  memberId,
  name,
  householdName,
  people,
  canWrite,
}: {
  memberId: string;
  name: string;
  householdName: string | null;
  people: { id: string; name: string; role: string | null }[];
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState<Picked | null>(null);
  const link = useAction(linkFamilyAction, {
    onSuccess: () => {
      setAdding(false);
      setOther(null);
    },
  });
  const leave = useAction(leaveFamilyAction);
  return (
    <Card>
      <CardHeader
        title={householdName ?? "Family"}
        action={
          canWrite && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus /> Link
            </Button>
          )
        }
      />
      <CardBody>
        {people.length ? (
          <ul className="flex flex-col gap-2">
            {people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                <Link href={`/members/${p.id}`} className="font-medium hover:text-accent">
                  {p.name}
                </Link>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-faint">{p.role ? ROLE_LABEL[p.role] : ""}</span>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${p.name} from this family`}
                      onClick={() => leave.run({ memberId: p.id, from: memberId })}
                    >
                      <X />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Home className="size-4" /> No family members linked.
          </p>
        )}
      </CardBody>
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && (
          <DialogContent
            title={`Link ${name}'s family`}
            description="Children under 18 are registered in the Children module and linked to parents there."
            footer={
              other ? (
                <>
                  <Button onClick={() => setOther(null)}>Back</Button>
                  <Button variant="primary" type="submit" form="family-form" loading={link.pending}>
                    Link family
                  </Button>
                </>
              ) : undefined
            }
          >
            {!other ? (
              <MemberPicker onPick={setOther} exclude={[memberId, ...people.map((p) => p.id)]} autoFocus />
            ) : (
              <form
                id="family-form"
                className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  link.run({
                    memberId,
                    otherId: other.id,
                    memberRole: fd.get("memberRole") as "head",
                    otherRole: fd.get("otherRole") as "head",
                  });
                }}
              >
                {other.inHousehold && (
                  <Note tone="warn" className="col-span-full">
                    {other.name} is already in a family. {name} will join it.
                  </Note>
                )}
                <Field label={name} htmlFor="f-me">
                  <Select id="f-me" name="memberRole" defaultValue="head">
                    {Object.entries(ROLE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={other.name} htmlFor="f-other">
                  <Select id="f-other" name="otherRole" defaultValue="spouse">
                    {Object.entries(ROLE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              </form>
            )}
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

export function StartFollowup({ memberId, firstTimer }: { memberId: string; firstTimer: boolean }) {
  const router = useRouter();
  const start = useAction(startFollowupAction, { onSuccess: (r) => router.push(`/follow-up?open=${r.id}`) });
  return (
    <Button
      loading={start.pending}
      onClick={() => start.run({ memberId, reason: firstTimer ? "first_timer" : "other" })}
    >
      <Route /> Follow up
    </Button>
  );
}
