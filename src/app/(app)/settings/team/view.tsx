"use client";
import { useState } from "react";
import { MailPlus, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Checkbox } from "@/components/ui/input";
import { Person } from "@/components/ui/avatar";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction, formToObject } from "@/components/ui/use-action";
import { timeAgo, formatDate } from "@/lib/format";
import { inviteAction, revokeInviteAction, updateMemberAction } from "../actions";

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
};
type Props = {
  me: string;
  people: P[];
  invites: { id: string; email: string; name: string; roleId: string; expiresAt: string }[];
  roles: { id: string; name: string; key: string }[];
  branches: { id: string; name: string }[];
};

function BranchPicker({ branches, selected }: { branches: Props["branches"]; selected: string[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Branches they can see</legend>
      <p className="text-xs text-faint">Leave all unticked for access to every branch.</p>
      <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        {branches.map((b) => (
          <Checkbox
            key={b.id}
            name="branchIds"
            value={b.id}
            data-multi="1"
            defaultChecked={selected.includes(b.id)}
            label={b.name}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function TeamView({ me, people, invites, roles, branches }: Props) {
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<P | null>(null);
  const invite = useAction(inviteAction, { onSuccess: () => setInviting(false) });
  const update = useAction(updateMemberAction, { onSuccess: () => setEditing(null) });
  const revoke = useAction(revokeInviteAction);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "—";
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
            <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
              <MailPlus /> Invite someone
            </Button>
          }
        />
        <div className="mt-3">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Branches</Th>
                <Th>Two-step</Th>
                <Th>Last active</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <Tr key={p.membershipId} className={p.status === "disabled" ? "opacity-55" : undefined}>
                  <Td>
                    <Person name={p.name} sub={p.email} />
                  </Td>
                  <Td>
                    <div className="font-medium">{p.roleName}</div>
                    {p.title && <div className="text-xs text-faint">{p.title}</div>}
                  </Td>
                  <Td className="text-muted">{branchNames(p.branchIds)}</Td>
                  <Td>
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
                    {p.status === "disabled" ? <Badge>Disabled</Badge> : p.lastLogin ? timeAgo(p.lastLogin) : "Never"}
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(p)}
                      disabled={
                        p.userId === me &&
                        p.roleKey === "owner" &&
                        people.filter((x) => x.roleKey === "owner").length === 1
                      }
                    >
                      Edit
                    </Button>
                  </Td>
                </Tr>
              ))}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={revoke.pending}
                        onClick={() => revoke.run({ id: i.id })}
                      >
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

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent
          title="Invite a team member"
          description="They'll get an email with a link to set their password. Invitations last 7 days."
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
              <Select id="i-role" name="roleId" required defaultValue="">
                <option value="" disabled>
                  Choose a role
                </option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
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
                  membershipId: editing.membershipId,
                });
              }}
            >
              <Field label="Role" htmlFor="e-role">
                <Select id="e-role" name="roleId" defaultValue={editing.roleId}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Access" htmlFor="e-status">
                <Select id="e-status" name="status" defaultValue={editing.status}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled (can't sign in to this church)</option>
                </Select>
              </Field>
              <Field label="Job title" htmlFor="e-title" optional>
                <Input id="e-title" name="title" defaultValue={editing.title} />
              </Field>
              <Field label="Staff ID" htmlFor="e-staff" optional hint="Shown on check-in and approval records.">
                <Input id="e-staff" name="staffId" defaultValue={editing.staffId} />
              </Field>
              <div className="col-span-full">
                <BranchPicker branches={branches} selected={editing.branchIds} />
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
