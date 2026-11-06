"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Coins, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { formToObject, useAction } from "@/components/ui/use-action";
import { formatDate, naira } from "@/lib/format";
import { createBatchAction } from "../actions";
import { BATCH_KIND, BATCH_STATUS } from "../labels";

type Row = {
  id: string;
  batchNo: string;
  kind: string;
  label: string;
  givenOn: string;
  status: string;
  totalKobo: number;
  countedByName: string;
  verifiedByName: string | null;
  branchName: string;
  mine: boolean;
};

export function BatchesView({
  list,
  status,
  today,
  services,
  branches,
  openNew,
  can,
}: {
  list: { rows: Row[]; total: number; page: number; pageSize: number };
  status: string;
  today: string;
  services: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  openNew: boolean;
  can: { record: boolean; verify: boolean };
}) {
  const router = useRouter();
  const path = usePathname();
  const [creating, setCreating] = useState(openNew && can.record);
  return (
    <>
      <PageHeader
        title="Collections"
        description="Offerings counted after each service, and bank transfers entered from the statement. One person counts; someone else verifies."
        actions={
          can.record && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> Count a collection
            </Button>
          )
        }
      />
      <LinkTabs
        className="self-start"
        current={status || "all"}
        tabs={[
          { key: "all", label: "All", href: path },
          { key: "submitted", label: "Waiting for verification", href: `${path}?status=submitted` },
          { key: "draft", label: "Drafts", href: `${path}?status=draft` },
          { key: "rejected", label: "Sent back", href: `${path}?status=rejected` },
          { key: "verified", label: "Verified", href: `${path}?status=verified` },
        ]}
      />
      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={<Coins />}
            title={status ? "Nothing here" : "No collections yet"}
            action={
              can.record &&
              !status && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus /> Count a collection
                </Button>
              )
            }
          >
            {status
              ? "Collections in this state will appear here."
              : "After a service, count the offering by fund and how it was given, then send it to a second person to verify."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Collection</Th>
                <Th className="max-md:hidden">Counted by</Th>
                <Th className="max-lg:hidden">Verified by</Th>
                <Th>Status</Th>
                <Th num>Total</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <Tr key={r.id} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/giving/batches/${r.id}`)}>
                  <Td>
                    <Link
                      href={`/giving/batches/${r.id}`}
                      className="font-medium hover:text-accent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.label}
                    </Link>
                    <div className="text-xs text-faint">
                      <span className="font-mono">{r.batchNo}</span> · {formatDate(r.givenOn, "week")} · {BATCH_KIND[r.kind]}
                      {branches.length > 1 && ` · ${r.branchName}`}
                    </div>
                  </Td>
                  <Td className="max-md:hidden">
                    {r.countedByName}
                    {r.mine && <span className="text-faint"> (you)</span>}
                  </Td>
                  <Td className="text-muted max-lg:hidden">{r.verifiedByName ?? "—"}</Td>
                  <Td>
                    <Badge tone={BATCH_STATUS[r.status]!.tone}>{BATCH_STATUS[r.status]!.label}</Badge>
                    {r.status === "submitted" && can.verify && !r.mine && (
                      <span className="ml-2 text-xs font-medium text-accent max-sm:hidden">Your turn</span>
                    )}
                  </Td>
                  <Td num className="font-medium">
                    {naira(r.totalKobo)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          hrefFor={(p) => `${path}?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`}
        />
      </Card>
      <NewBatchDialog
        open={creating}
        onOpenChange={setCreating}
        today={today}
        services={services}
        branches={branches}
      />
    </>
  );
}

function NewBatchDialog({
  open,
  onOpenChange,
  today,
  services,
  branches,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  today: string;
  services: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState("service");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [label, setLabel] = useState(services[0]?.name ?? "");
  const save = useAction(createBatchAction, { onSuccess: (d) => router.push(`/giving/batches/${d.id}`) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="Count a collection"
          description="You'll enter the amounts next. Someone else verifies before anything reaches the ledger."
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="batch-form" loading={save.pending}>
                Start counting
              </Button>
            </>
          }
        >
          <form
            id="batch-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              save.run(formToObject(e.currentTarget) as Parameters<typeof createBatchAction>[0]);
            }}
          >
            <Field label="What are you counting?" htmlFor="b-kind" className="col-span-full">
              <Select
                id="b-kind"
                name="kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  if (e.target.value === "transfers") setLabel(`Bank transfers, ${formatDate(today, "short")}`);
                  else if (e.target.value === "service") setLabel(services.find((s) => s.id === serviceId)?.name ?? "");
                }}
              >
                <option value="service">A service&apos;s offering</option>
                <option value="transfers">Bank transfers from the statement</option>
                <option value="other">Something else</option>
              </Select>
            </Field>
            {kind === "service" && services.length > 0 && (
              <Field label="Service" htmlFor="b-service" className="col-span-full">
                <Select
                  id="b-service"
                  name="serviceId"
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setLabel(services.find((s) => s.id === e.target.value)?.name ?? label);
                  }}
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="">Not one of today&apos;s services</option>
                </Select>
              </Field>
            )}
            <Field label="Name" htmlFor="b-label" error={save.fieldErrors.label} className="col-span-full">
              <Input
                id="b-label"
                name="label"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Sunday First Service"
              />
            </Field>
            <Field label="Date given" htmlFor="b-date" error={save.fieldErrors.givenOn}>
              <Input id="b-date" name="givenOn" type="date" required defaultValue={today} max={today} />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" htmlFor="b-branch">
                <Select id="b-branch" name="branchId" defaultValue={branches[0]?.id}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={branches[0]?.id} />
            )}
            {kind !== "service" && <input type="hidden" name="serviceId" value="" />}
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
