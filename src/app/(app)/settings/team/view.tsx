"use client";
import { useState } from "react";
import Link from "next/link";
import { KeyRound, MailPlus, MoreHorizontal, Pause, Pencil, Play, ShieldAlert, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Select, Checkbox, Textarea } from "@/components/ui/input";
import { Person } from "@/components/ui/avatar";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction, formToObject } from "@/components/ui/use-action";
import { timeAgo, formatDate } from "@/lib/format";
import { MemberPicker } from "../../members/member-picker";
import {
  addTeamMemberAction,
  inviteAction,
  removeTeamMemberAction,
  resetTeamPasswordAction,
  revokeInviteAction,
  setTeamStatusAction,
  teamCandidateAction,
  updateMemberAction,
} from "../actions";

type P = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  roleKey: string;
  branchIds: string[];
  status: "active" | "disabled";
  title: string;
  staffId: string;
  mfa: boolean;
  lastLogin: string | null;
  pendingFirstSignIn: boolean;
  memberId: string | null;
};
type Props = {
  me: string;
  iAmOwner: boolean;
  canEditMembers: boolean;
  people: P[];
  invites: { id: string; email: string; name: string; roleId: string; expiresAt: string }[];
  roles: { id: string; name: string; key: string }[];
  branches: { id: string; name: string }[];
};

function BranchPicker({ branches, selected }: { branches: Props["branches"]; selected: string[] }) {
  if (branches.length < 2) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Branches they can see</legend>
      <p className="text-xs text-faint">Leave all unticked for access to every branch.</p>
      <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        {branches.map((b) => (
          <Checkbox key={b.id} name="branchIds" value={b.id} data-multi="1" defaultChecked={selected.includes(b.id)} label={b.name} />
        ))}
      </div>
    </fieldset>
  );
}

function RoleSelect({ roles, id, defaultValue, iAmOwner }: { roles: Props["roles"]; id: string; defaultValue?: string; iAmOwner: boolean }) {
  return (
    <Select id={id} name="roleId" required defaultValue={defaultValue ?? ""}>
      <option value="" disabled>
        Choose a role
      </option>
      {roles
        .filter((r) => iAmOwner || r.key !== "owner" || r.id === defaultValue)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
    </Select>
  );
}

type Confirm = { kind: "reset" | "suspend" | "reactivate" | "remove"; p: P };

export function TeamView({ me, iAmOwner, canEditMembers, people, invites, roles, branches }: Props) {
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<P | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const invite = useAction(inviteAction, { onSuccess: () => setInviting(false) });
  const update = useAction(updateMemberAction, { onSuccess: () => setEditing(null) });
  const revoke = useAction(revokeInviteAction);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "—";
  const owners = people.filter((x) => x.roleKey === "owner" && x.status === "active").length;
  const branchNames = (ids: string[]) =>
    ids.length
      ? ids
          .map((id) => branches.find((b) => b.id === id)?.name)
          .filter(Boolean)
          .join(", ")
      : "All branches";

  return (
    <>
      <Card>
        <CardHeader
          title={`Team (${people.length})`}
          action={
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setInviting(true)}>
                <MailPlus /> Invite by email
              </Button>
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                <UserPlus /> Add from members
              </Button>
            </div>
          }
        />
        <div className="mt-3">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th className="max-md:hidden">Branches</Th>
                <Th className="max-md:hidden">Two-step</Th>
                <Th>Last active</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const self = p.userId === me;
                const ownerLocked = p.roleKey === "owner" && !iAmOwner;
                return (
                  <Tr key={p.membershipId} className={p.status === "disabled" ? "opacity-60" : undefined}>
                    <Td>
                      <Person name={p.name} sub={p.email} />
                      {p.memberId && (
                        <Link href={`/members/${p.memberId}`} className="ml-11 text-xs text-accent hover:underline">
                          Member profile
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <div className="font-medium">{p.roleName}</div>
                      {p.title && <div className="text-xs text-faint">{p.title}</div>}
                    </Td>
                    <Td className="text-muted max-md:hidden">{branchNames(p.branchIds)}</Td>
                    <Td className="max-md:hidden">
                      {p.mfa ? (
                        <Badge tone="good">
                          <ShieldCheck /> On
                        </Badge>
                      ) : (
                        <Badge tone="warn">
                          <ShieldAlert /> Off
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-muted">
                      {p.status === "disabled" ? (
                        <Badge tone="bad">Suspended</Badge>
                      ) : p.pendingFirstSignIn ? (
                        <Badge tone="accent">Hasn&apos;t signed in yet</Badge>
                      ) : p.lastLogin ? (
                        timeAgo(p.lastLogin)
                      ) : (
                        "Never"
                      )}
                    </Td>
                    <Td className="text-right">
                      {self ? (
                        <Link href="/settings/account" className="text-xs text-muted hover:text-fg">
                          You
                        </Link>
                      ) : (
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${p.name}`} disabled={ownerLocked}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownTrigger>
                          <DropdownContent align="end">
                            <DropdownItem onSelect={() => setEditing(p)}>
                              <Pencil /> Edit role and access
                            </DropdownItem>
                            <DropdownItem onSelect={() => setConfirm({ kind: "reset", p })}>
                              <KeyRound /> Reset password
                            </DropdownItem>
                            {p.status === "active" ? (
                              <DropdownItem onSelect={() => setConfirm({ kind: "suspend", p })} disabled={p.roleKey === "owner" && owners <= 1}>
                                <Pause /> Suspend access
                              </DropdownItem>
                            ) : (
                              <DropdownItem onSelect={() => setConfirm({ kind: "reactivate", p })}>
                                <Play /> Restore access
                              </DropdownItem>
                            )}
                            <DropdownSeparator />
                            <DropdownItem danger onSelect={() => setConfirm({ kind: "remove", p })} disabled={p.roleKey === "owner" && owners <= 1}>
                              <Trash2 /> Remove from team
                            </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader title="Pending invitations" />
          <div className="mt-3">
            <Table>
              <tbody>
                {invites.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Person name={i.name || i.email} sub={i.email} size="sm" />
                    </Td>
                    <Td>{roleName(i.roleId)}</Td>
                    <Td className="text-muted">Expires {formatDate(i.expiresAt, "short")}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" loading={revoke.pending} onClick={() => revoke.run({ id: i.id })}>
                        Cancel invitation
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      <AddFromMembers open={adding} onClose={() => setAdding(false)} roles={roles} branches={branches} iAmOwner={iAmOwner} />

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent
          title="Invite someone new"
          description="For someone who isn't in your members directory. They'll get a link to set their own password. Invitations last 7 days."
          footer={
            <>
              <Button onClick={() => setInviting(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="invite-form" loading={invite.pending}>
                Send invitation
              </Button>
            </>
          }
        >
          <form
            id="invite-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              invite.run(formToObject(e.currentTarget) as Parameters<typeof inviteAction>[0]);
            }}
          >
            <Field label="Full name" htmlFor="i-name" error={invite.fieldErrors.name}>
              <Input id="i-name" name="name" required />
            </Field>
            <Field label="Email" htmlFor="i-email" error={invite.fieldErrors.email}>
              <Input id="i-email" name="email" type="email" required />
            </Field>
            <Field label="Role" htmlFor="i-role" error={invite.fieldErrors.roleId}>
              <RoleSelect roles={roles} id="i-role" iAmOwner={iAmOwner} />
            </Field>
            <Field label="Job title" htmlFor="i-title" optional>
              <Input id="i-title" name="title" placeholder="e.g. Church Secretary" />
            </Field>
            <div className="col-span-full">
              <BranchPicker branches={branches} selected={[]} />
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent
            title={`Edit ${editing.name}`}
            footer={
              <>
                <Button onClick={() => setEditing(null)}>Cancel</Button>
                <Button variant="primary" type="submit" form="edit-form" loading={update.pending}>
                  Save
                </Button>
              </>
            }
          >
            <form
              id="edit-form"
              className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
              onSubmit={(e) => {
                e.preventDefault();
                update.run({
                  ...(formToObject(e.currentTarget) as Parameters<typeof updateMemberAction>[0]),
                  status: editing.status,
                  membershipId: editing.membershipId,
                });
              }}
            >
              <Field label="Role" htmlFor="e-role">
                <RoleSelect roles={roles} id="e-role" defaultValue={editing.roleId} iAmOwner={iAmOwner} />
              </Field>
              <Field label="Job title" htmlFor="e-title" optional>
                <Input id="e-title" name="title" defaultValue={editing.title} />
              </Field>
              <Field label="Staff ID" htmlFor="e-staff" optional hint="Shown on check-in and approval records." className="col-span-full">
                <Input id="e-staff" name="staffId" defaultValue={editing.staffId} />
              </Field>
              <div className="col-span-full">
                <BranchPicker branches={branches} selected={editing.branchIds} />
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} canEditMembers={canEditMembers} />
    </>
  );
}

function AddFromMembers({ open, onClose, roles, branches, iAmOwner }: { open: boolean; onClose: () => void; roles: Props["roles"]; branches: Props["branches"]; iAmOwner: boolean }) {
  const [picked, setPicked] = useState<{ id: string; name: string; memberNo: string } | null>(null);
  const [info, setInfo] = useState<{ email: string | null; onTeam: boolean; hasAccount: boolean } | null>(null);
  const candidate = useAction(teamCandidateAction, { onSuccess: (d) => setInfo(d) });
  const reset = () => {
    setPicked(null);
    setInfo(null);
  };
  const add = useAction(addTeamMemberAction, {
    onSuccess: () => {
      reset();
      onClose();
    },
  });
  const fe = add.fieldErrors;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      {open && (
        <DialogContent
          title="Add a team member"
          description="Choose someone from your members directory and give them a role. We'll email them their sign-in details, and they'll choose their own password the first time they sign in."
          footer={
            <>
              <Button
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="add-team-form" loading={add.pending} disabled={!picked || !info || info.onTeam}>
                Add to team
              </Button>
            </>
          }
        >
          {!picked ? (
            <Field label="Member" htmlFor="at-member" error={fe.memberId}>
              <MemberPicker
                placeholder="Search members by name, phone or member number"
                autoFocus
                onPick={(m) => {
                  setPicked(m);
                  setInfo(null);
                  candidate.run({ memberId: m.id });
                }}
              />
            </Field>
          ) : (
            <form
              id="add-team-form"
              className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                add.run({
                  memberId: picked.id,
                  email: String(f.get("email") ?? ""),
                  roleId: String(f.get("roleId") ?? ""),
                  title: String(f.get("title") ?? ""),
                  branchIds: f.getAll("branchIds").map(String),
                });
              }}
            >
              <div className="col-span-full flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px]" data-testid="picked-member">
                <span>
                  <span className="font-medium">{picked.name}</span> <span className="text-faint">{picked.memberNo}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={reset}>
                  Change
                </Button>
              </div>
              {info?.onTeam && (
                <Note tone="warn" className="col-span-full">
                  {picked.name} is already on your team. Use their row in the team list to change their role.
                </Note>
              )}
              {info && !info.onTeam && (
                <>
                  <Field
                    label="Email for signing in"
                    htmlFor="at-email"
                    error={fe.email}
                    className="col-span-full"
                    hint={info.email ? (info.hasAccount ? "They already use Build My Church with this email, so they'll keep their password." : "From their member record.") : "Their member record has no email. This one will be saved to it."}
                  >
                    <Input id="at-email" name="email" type="email" required defaultValue={info.email ?? ""} />
                  </Field>
                  <Field label="Role" htmlFor="at-role" error={fe.roleId}>
                    <RoleSelect roles={roles} id="at-role" iAmOwner={iAmOwner} />
                  </Field>
                  <Field label="Job title" htmlFor="at-title" optional>
                    <Input id="at-title" name="title" placeholder="e.g. Head of Media" />
                  </Field>
                  <div className="col-span-full">
                    <BranchPicker branches={branches} selected={[]} />
                  </div>
                </>
              )}
              {!info && <p className="col-span-full text-[13px] text-muted">Checking their record…</p>}
            </form>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function ConfirmDialog({ confirm, onClose, canEditMembers }: { confirm: Confirm | null; onClose: () => void; canEditMembers: boolean }) {
  const done = { onSuccess: onClose };
  const reset = useAction(resetTeamPasswordAction, done);
  const status = useAction(setTeamStatusAction, done);
  const remove = useAction(removeTeamMemberAction, done);
  const [alsoMember, setAlsoMember] = useState(false);
  const [reason, setReason] = useState("");
  if (!confirm) return null;
  const { kind, p } = confirm;
  const first = p.name.split(" ").find((w) => !/\.$/.test(w)) ?? p.name;
  const copy = {
    reset: {
      title: `Reset ${first}'s password?`,
      body: `We'll email ${p.email} a new temporary password and sign them out everywhere. They'll choose their own password when they next sign in.`,
      action: "Reset password",
    },
    suspend: {
      title: `Suspend ${first}'s access?`,
      body: `${p.name} won't be able to open this church until you restore access. Their role, history and member record stay as they are. We'll let them know by email.`,
      action: "Suspend access",
    },
    reactivate: {
      title: `Restore ${first}'s access?`,
      body: `${p.name} can sign in again as ${p.roleName}. We'll let them know by email.`,
      action: "Restore access",
    },
    remove: {
      title: `Remove ${first} from the team?`,
      body: `${p.name} loses access to this church straight away. Records of what they did stay in the audit log.`,
      action: alsoMember ? "Remove from team and directory" : "Remove from team",
    },
  }[kind];
  const pending = reset.pending || status.pending || remove.pending;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          setAlsoMember(false);
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent
        title={copy.title}
        description={copy.body}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant={kind === "remove" || kind === "suspend" ? "danger" : "primary"}
              loading={pending}
              onClick={() => {
                if (kind === "reset") reset.run({ membershipId: p.membershipId });
                else if (kind === "suspend") status.run({ membershipId: p.membershipId, status: "disabled" });
                else if (kind === "reactivate") status.run({ membershipId: p.membershipId, status: "active" });
                else remove.run({ membershipId: p.membershipId, alsoRemoveMember: alsoMember, reason });
              }}
            >
              {copy.action}
            </Button>
          </>
        }
      >
        {kind === "remove" && (
          <div className="flex flex-col gap-3">
            <Note>Their membership in the church directory is kept, so they still appear in attendance, giving and groups, unless you tick the box below.</Note>
            {canEditMembers && p.memberId && (
              <Checkbox checked={alsoMember} onChange={(e) => setAlsoMember(e.target.checked)} label={`Also remove ${first} from the members directory`} />
            )}
            <Field label="Reason" htmlFor="rm-reason" optional hint="Saved in the audit log.">
              <Textarea id="rm-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Relocated to Abuja" />
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
