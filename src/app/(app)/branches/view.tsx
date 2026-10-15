"use client";
import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction, formToObject } from "@/components/ui/use-action";
import { archiveBranchAction, saveBranchAction } from "./actions";

type B = {
  id: string;
  name: string;
  code: string;
  level: string;
  parentId: string | null;
  depth: number;
  address: string;
  phone: string;
  pastorName: string;
  archived: boolean;
};

export function BranchesView({ branches }: { branches: B[] }) {
  const [edit, setEdit] = useState<B | "new" | null>(null);
  const save = useAction(saveBranchAction, { onSuccess: () => setEdit(null) });
  const arch = useAction(archiveBranchAction);
  const cur = edit === "new" ? null : edit;
  return (
    <>
      <PageHeader
        title="Branches"
        description="Each branch keeps its own members and records. Headquarters sees everything."
        actions={
          <Button variant="primary" onClick={() => setEdit("new")}>
            <Plus /> Add branch
          </Button>
        }
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Branch</Th>
              <Th>Code</Th>
              <Th>Pastor in charge</Th>
              <Th>Address</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <Tr key={b.id} className={b.archived ? "opacity-55" : undefined}>
                <Td>
                  <div className="flex items-center gap-2" style={{ paddingLeft: b.depth * 20 }}>
                    <Building2 className="size-4 text-faint" />
                    <b className="font-medium">{b.name}</b>
                    {b.level === "hq" && <Badge tone="accent">HQ</Badge>}
                    {b.archived && <Badge>Archived</Badge>}
                  </div>
                </Td>
                <Td className="font-mono text-xs">{b.code}</Td>
                <Td>{b.pastorName || <span className="text-faint">—</span>}</Td>
                <Td className="text-muted">{b.address || <span className="text-faint">—</span>}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(b)}>
                    Edit
                  </Button>
                  {b.level !== "hq" && (
                    <Button size="sm" variant="ghost" onClick={() => arch.run({ id: b.id, archived: !b.archived })}>
                      {b.archived ? "Restore" : "Archive"}
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <DialogContent
            title={cur ? `Edit ${cur.name}` : "Add a branch"}
            footer={
              <>
                <Button onClick={() => setEdit(null)}>Cancel</Button>
                <Button variant="primary" type="submit" form="branch-form" loading={save.pending}>
                  Save branch
                </Button>
              </>
            }
          >
            <form
              id="branch-form"
              className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
              onSubmit={(e) => {
                e.preventDefault();
                save.run({ ...(formToObject(e.currentTarget) as Parameters<typeof saveBranchAction>[0]), id: cur?.id });
              }}
            >
              <Field label="Branch name" htmlFor="b-name" error={save.fieldErrors.name}>
                <Input id="b-name" name="name" defaultValue={cur?.name} required placeholder="e.g. Wuse" />
              </Field>
              <Field
                label="Short code"
                htmlFor="b-code"
                error={save.fieldErrors.code}
                hint="Used in reference numbers, e.g. WUSE."
              >
                <Input id="b-code" name="code" defaultValue={cur?.code} required maxLength={10} className="uppercase" />
              </Field>
              {cur?.level !== "hq" && (
                <Field
                  label="Reports to"
                  htmlFor="b-parent"
                  error={save.fieldErrors.parentId}
                  className="col-span-full"
                >
                  <Select id="b-parent" name="parentId" defaultValue={cur?.parentId ?? ""}>
                    {branches
                      .filter((b) => !b.archived && b.id !== cur?.id)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {"— ".repeat(b.depth)}
                          {b.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <Field label="Pastor in charge" htmlFor="b-pastor" optional>
                <Input id="b-pastor" name="pastorName" defaultValue={cur?.pastorName} />
              </Field>
              <Field label="Phone" htmlFor="b-phone" optional>
                <Input id="b-phone" name="phone" defaultValue={cur?.phone} inputMode="tel" />
              </Field>
              <Field label="Address" htmlFor="b-addr" className="col-span-full" optional>
                <Input id="b-addr" name="address" defaultValue={cur?.address} />
              </Field>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
