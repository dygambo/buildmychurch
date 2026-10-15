"use client";
import { useState } from "react";
import { Plus, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { useAction, formToObject } from "@/components/ui/use-action";
import { saveRoleAction } from "../actions";

type Role = { id: string; key: string; name: string; description: string; permissions: string[]; isSystem: boolean };
const GROUPS: [string, string][] = [
  ["members", "Members"],
  ["followup", "Follow-up"],
  ["groups", "Groups"],
  ["attendance", "Attendance"],
  ["children", "Children"],
  ["giving", "Giving"],
  ["finance", "Finance"],
  ["memo", "E-Memo"],
  ["messaging", "Messaging"],
  ["schedules", "Service schedules"],
  ["events", "Events"],
  ["volunteers", "Volunteers"],
  ["care", "Care"],
  ["forms", "Forms"],
  ["reports", "Reports"],
  ["branches", "Branches"],
  ["settings", "Settings"],
  ["users", "Team"],
  ["audit", "Audit"],
  ["privacy", "Privacy"],
  ["billing", "Billing"],
];

export function RolesView({ roles, permissions }: { roles: Role[]; permissions: Record<string, string> }) {
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const save = useAction(saveRoleAction, { onSuccess: () => setEditing(null) });
  const cur =
    editing === "new" ? { id: "", key: "", name: "", description: "", permissions: [], isSystem: false } : editing;
  return (
    <>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus /> New role
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        {roles.map((r) => (
          <Card key={r.id}>
            <CardBody className="flex h-full flex-col gap-2.5">
              <div className="flex items-start gap-2">
                <h3 className="flex-1 text-[15px] font-semibold">{r.name}</h3>
                {r.key === "owner" ? (
                  <Badge tone="accent">
                    <Lock /> All access
                  </Badge>
                ) : (
                  <Badge>{r.permissions.length} permissions</Badge>
                )}
              </div>
              <p className="flex-1 text-[13px] text-muted">{r.description || "Custom role."}</p>
              {r.key !== "owner" && (
                <Button size="sm" className="self-start" onClick={() => setEditing(r)}>
                  Edit permissions
                </Button>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {cur && (
          <DialogContent
            wide
            title={cur.id ? `Edit ${cur.name}` : "New role"}
            description="Changes apply the next time each person loads a page."
            footer={
              <>
                <Button onClick={() => setEditing(null)}>Cancel</Button>
                <Button variant="primary" type="submit" form="role-form" loading={save.pending}>
                  Save role
                </Button>
              </>
            }
          >
            <form
              id="role-form"
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const o = formToObject(e.currentTarget) as { name: string; description: string; permissions: string[] };
                save.run({ id: cur.id || undefined, ...o });
              }}
            >
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <Field label="Role name" htmlFor="r-name" error={save.fieldErrors.name}>
                  <Input id="r-name" name="name" defaultValue={cur.name} required />
                </Field>
                <Field label="Description" htmlFor="r-desc" optional>
                  <Input id="r-desc" name="description" defaultValue={cur.description} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 max-sm:grid-cols-1">
                {GROUPS.map(([prefix, label]) => {
                  const keys = Object.keys(permissions).filter((k) => k.split(".")[0] === prefix);
                  if (!keys.length) return null;
                  return (
                    <fieldset key={prefix} className="flex flex-col gap-1.5">
                      <legend className="mb-1 text-xs font-semibold tracking-wide text-faint uppercase">{label}</legend>
                      {keys.map((k) => (
                        <Checkbox
                          key={k}
                          name="permissions"
                          value={k}
                          data-multi="1"
                          defaultChecked={cur.permissions.includes(k)}
                          label={permissions[k]}
                        />
                      ))}
                    </fieldset>
                  );
                })}
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
