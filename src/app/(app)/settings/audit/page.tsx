import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listAudit } from "@/server/services/org";
import { Card } from "@/components/ui/card";
import { Person } from "@/components/ui/avatar";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { SearchBox } from "@/components/ui/search-box";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("audit.read")) redirect("/settings/account");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await withOrg(ctx.org.id, (tx) => listAudit(tx, ctx, { q: sp.q, page, pageSize: 30 }));
  const qs = (p: number) => `/settings/audit?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3.5">
        <h3 className="text-sm font-semibold">Audit log</h3>
        <p className="text-xs text-faint">Read-only. Records can't be edited or deleted.</p>
        <div className="ml-auto w-72 max-w-full">
          <SearchBox placeholder="Search actions or people" />
        </div>
      </div>
      <div className="mt-3">
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>What happened</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</Td>
                <Td>
                  <Person name={r.actorName} size="sm" />
                </Td>
                <Td>
                  {r.summary}
                  <div className="font-mono text-[11px] text-faint">{r.action}</div>
                </Td>
              </Tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} className="px-3 py-10 text-center text-muted">
                  Nothing matches that search.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
      <Pagination page={page} pageSize={30} total={total} hrefFor={qs} />
    </Card>
  );
}
