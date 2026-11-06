"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, FilePlus2, Lock, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBox } from "@/components/ui/search-box";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, naira } from "@/lib/format";
import type { MemoRow } from "@/server/services/memos";
import { CATEGORY, statusOf } from "./labels";

export function MemosView({
  list,
  counts,
  box,
  status,
  userId,
  can,
}: {
  list: { rows: MemoRow[]; total: number; page: number; pageSize: number };
  counts: { action: number; pay: number };
  box: string;
  status: string;
  userId: string;
  can: { approve: boolean; disburse: boolean; settings: boolean };
}) {
  const path = usePathname();
  const sp = useSearchParams();
  const href = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    if (k === "box") next.delete("status");
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="E-Memo"
        description="Requests that need approval: funds, welfare, events, repairs. Each memo gets a reference number and a full record of who approved it."
        actions={
          <>
            {can.settings && (
              <Button asChild variant="ghost">
                <Link href="/memos/settings">
                  <Settings /> Route and templates
                </Link>
              </Button>
            )}
            <Button asChild variant="primary">
              <Link href="/memos/new">
                <FilePlus2 /> New memo
              </Link>
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <LinkTabs
          className="self-start"
          current={box}
          tabs={[
            ...(can.approve ? [{ key: "action", label: "Needs my approval", href: href("box", "action"), count: counts.action }] : []),
            { key: "mine", label: "My memos", href: href("box", "mine") },
            ...(can.disburse ? [{ key: "pay", label: "To pay", href: href("box", "pay"), count: counts.pay }] : []),
            { key: "all", label: "All I can see", href: href("box", "all") },
          ]}
        />
        <SearchBox placeholder="Subject, reference or name" className="ml-auto w-64 max-sm:w-full" />
      </div>
      {(box === "mine" || box === "all") && (
        <LinkTabs
          className="self-start"
          current={status || "any"}
          tabs={[
            { key: "any", label: "Any status", href: href("status", "") },
            ...(box === "mine" ? [{ key: "draft", label: "Drafts", href: href("status", "draft") }] : []),
            { key: "pending", label: "Pending", href: href("status", "pending") },
            { key: "query", label: "Queried", href: href("status", "query") },
            { key: "approved", label: "Approved", href: href("status", "approved") },
            { key: "declined", label: "Declined", href: href("status", "declined") },
          ]}
        />
      )}
      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            title={box === "action" ? "Nothing waiting for you" : box === "pay" ? "Nothing to pay" : "No memos here"}
            action={
              box === "mine" && (
                <Button asChild variant="primary">
                  <Link href="/memos/new">
                    <FilePlus2 /> Write a memo
                  </Link>
                </Button>
              )
            }
          >
            {box === "action" ? "Memos that reach your step show up here, urgent ones first." : "Requisitions, welfare requests and proposals you raise or approve appear here."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Memo</Th>
                <Th className="max-md:hidden">From</Th>
                <Th num className="max-sm:hidden">
                  Amount
                </Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((m) => {
                const st = statusOf(m);
                return (
                  <Tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {m.urgent && (
                          <Badge tone="bad">
                            <AlertTriangle className="size-3" /> Urgent
                          </Badge>
                        )}
                        {m.confidential && <Lock className="size-3.5 text-faint" aria-label="Confidential" />}
                        <Link href={`/memos/${m.id}`} className="line-clamp-1 font-medium hover:text-accent">
                          {m.title}
                        </Link>
                      </div>
                      <div className="text-xs text-muted">
                        <span className="font-mono">{m.refNo ?? "Not sent"}</span> · {CATEGORY[m.category]}
                        {m.departmentName ? ` · ${m.departmentName}` : ""}
                      </div>
                    </Td>
                    <Td className="max-md:hidden">
                      {m.initiatorId === userId ? <span className="text-muted">You</span> : m.initiatorName}
                      <div className="text-xs text-faint">{formatDate(m.submittedAt ?? m.createdAt)}</div>
                    </Td>
                    <Td num className="max-sm:hidden">
                      {m.amountKobo ? naira(m.amountKobo) : <span className="text-faint">—</span>}
                      {m.disbursedAt && <div className="text-xs text-good">Paid</div>}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {(m.status === "pending" || m.status === "query") && m.stepLabel && <div className="mt-0.5 text-xs text-muted">With {m.stepLabel}</div>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          hrefFor={(p) => {
            const next = new URLSearchParams(sp.toString());
            next.set("page", String(p));
            return `${path}?${next}`;
          }}
        />
      </Card>
    </>
  );
}
