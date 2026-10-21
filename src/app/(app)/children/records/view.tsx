"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState, Note } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { verifyChainAction } from "../actions";

type Row = {
  id: string;
  childId: string;
  childNo: string;
  child: string;
  classGroup: string | null;
  service: string | null;
  checkedInAt: string;
  checkedInByName: string;
  checkInMethod: string;
  droppedOffBy: string | null;
  checkedOutAt: string | null;
  checkedOutByName: string | null;
  checkOutMethod: string | null;
  pickedUpBy: string | null;
  overrideReason: string | null;
};

const METHOD: Record<string, string> = { qr: "QR scan", manual: "Manual", code: "Pickup code" };

export function RecordsView({ from, to, child, rows }: { from: string; to: string; child?: string; rows: Row[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [result, setResult] = useState<{
    ok: boolean;
    count: number;
    brokenAt?: number;
    brokenOn?: string | null;
  } | null>(null);
  const verify = useAction(verifyChainAction, { onSuccess: (d) => setResult(d as never) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    n.set(k, v);
    router.replace(`${path}?${n}`, { scroll: false });
  };
  const qs = new URLSearchParams({ from, to, ...(child ? { child } : {}) }).toString();
  return (
    <>
      <PageHeader
        title="Check-in records"
        description="Every check-in and check-out, who did it and who brought or collected the child."
        actions={
          <>
            <Button loading={verify.pending} onClick={() => verify.run({})}>
              <ShieldCheck /> Verify records
            </Button>
            <Button variant="primary" asChild>
              <a href={`/children/records/export?${qs}`} download>
                <Download /> Export CSV
              </a>
            </Button>
          </>
        }
      />
      {result &&
        (result.ok ? (
          <Note tone="good" icon={<ShieldCheck />}>
            All {result.count.toLocaleString()} check-in and check-out records are intact. Nothing has been changed or
            deleted since it was recorded.
          </Note>
        ) : (
          <Note tone="bad" icon={<ShieldX />}>
            Record #{result.brokenAt} ({result.brokenOn ? formatDateTime(result.brokenOn) : "unknown date"})
            doesn&apos;t match its fingerprint. It, or one before it, was changed outside Build My Church. Report this
            to your Super Admin.
          </Note>
        ))}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="r-from">
          <Input
            id="r-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && set("from", e.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="r-to">
          <Input
            id="r-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && set("to", e.target.value)}
          />
        </Field>
        {child && (
          <Button variant="ghost" asChild>
            <Link href={`/children/records?from=${from}&to=${to}`}>Show all children</Link>
          </Button>
        )}
        <span className="ml-auto text-[13px] text-muted">{rows.length.toLocaleString()} visits</span>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No check-ins in these dates" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Child</Th>
                <Th>Checked in</Th>
                <Th>Checked out</Th>
                <Th className="max-lg:hidden">Method</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/children/${r.childId}`} className="font-medium hover:text-accent">
                      {r.child}
                    </Link>
                    <div className="text-xs text-faint">
                      {formatDate(r.checkedInAt)} · {r.classGroup}
                      {r.service && ` · ${r.service}`}
                    </div>
                  </Td>
                  <Td>
                    <div className="whitespace-nowrap">
                      {formatTime(r.checkedInAt)} by {r.checkedInByName}
                    </div>
                    <div className="text-xs text-faint">Dropped off by {r.droppedOffBy}</div>
                  </Td>
                  <Td>
                    {r.checkedOutAt ? (
                      <>
                        <div className="whitespace-nowrap">
                          {formatTime(r.checkedOutAt)} by {r.checkedOutByName}
                        </div>
                        <div className="text-xs text-faint">
                          {r.pickedUpBy ? `Picked up by ${r.pickedUpBy}` : r.overrideReason}
                        </div>
                        {r.overrideReason && r.pickedUpBy && (
                          <Badge tone="warn" className="mt-1">
                            {r.overrideReason}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Badge tone="good">In church</Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-muted max-lg:hidden">
                    In: {METHOD[r.checkInMethod]}
                    {r.checkOutMethod && (
                      <>
                        <br />
                        Out: {METHOD[r.checkOutMethod]}
                      </>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardBody className="text-xs text-faint">
          Records are chained with SHA-256 fingerprints: each record includes the fingerprint of the one before it, so
          changing or deleting any past record is detectable. Staff cannot edit or delete check-in history.
        </CardBody>
      </Card>
    </>
  );
}
