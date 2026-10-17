"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, Paperclip, Plus, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBox } from "@/components/ui/search-box";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, naira } from "@/lib/format";
import type { ExpenseFilters, ExpenseRow } from "@/server/services/expenses";
import { COLOR_VAR } from "../../giving/labels";
import { ExpenseDialog, type Option } from "../expense-form";
import { EXPENSE_STATUS } from "../labels";

export function ExpensesView({
  list,
  filters,
  userId,
  startOpen,
  categories,
  funds,
  branches,
  thresholdKobo,
  canApprove,
}: {
  list: { rows: ExpenseRow[]; total: number; sumKobo: number; page: number; pageSize: number };
  filters: ExpenseFilters;
  userId: string;
  startOpen: boolean;
  categories: Option[];
  funds: (Option & { restricted: boolean })[];
  branches: Option[];
  thresholdKobo: number;
  canApprove: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [creating, setCreating] = useState(startOpen);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    next.delete("new");
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const hrefWith = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    next.delete("new");
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  const exportHref = (format: string) => {
    const next = new URLSearchParams(sp.toString());
    next.delete("page");
    next.delete("new");
    next.set("format", format);
    return `/expenses/list/export?${next}`;
  };
  const filtered = Boolean(filters.q || filters.categoryId || filters.branchId || filters.fundId || filters.from || filters.to);
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Every payment out of the church. Raised by one person, approved by another, then paid."
        actions={
          <>
            <Button asChild variant="ghost">
              <a href={exportHref("xlsx")}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
            <Button asChild variant="ghost" className="max-sm:hidden">
              <a href={exportHref("csv")}>
                <Download /> CSV
              </a>
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> Record expense
            </Button>
          </>
        }
      />
      <LinkTabs
        className="self-start"
        current={filters.status ?? "all"}
        tabs={[
          { key: "all", label: "All", href: hrefWith("status", "") },
          { key: "open", label: "Open", href: hrefWith("status", "open") },
          { key: "submitted", label: canApprove ? "To approve" : "Waiting for approval", href: hrefWith("status", "submitted") },
          { key: "approved", label: "To pay", href: hrefWith("status", "approved") },
          { key: "paid", label: "Paid", href: hrefWith("status", "paid") },
          { key: "draft", label: "Drafts", href: hrefWith("status", "draft") },
        ]}
      />
      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchBox placeholder="Payee, description or number" className="w-64 max-sm:w-full" />
        <Field label="From" htmlFor="e-from">
          <Input id="e-from" type="date" defaultValue={filters.from} onChange={(e) => setParam("from", e.target.value)} />
        </Field>
        <Field label="To" htmlFor="e-to">
          <Input id="e-to" type="date" defaultValue={filters.to} onChange={(e) => setParam("to", e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="e-cat">
          <Select id="e-cat" value={filters.categoryId ?? ""} onChange={(e) => setParam("category", e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fund" htmlFor="e-fund">
          <Select id="e-fund" value={filters.fundId ?? ""} onChange={(e) => setParam("fund", e.target.value)}>
            <option value="">Any fund</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        {branches.length > 1 && (
          <Field label="Branch" htmlFor="e-branch">
            <Select id="e-branch" value={filters.branchId ?? ""} onChange={(e) => setParam("branch", e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {filtered && (
          <Button variant="ghost" onClick={() => router.replace(filters.status ? `${path}?status=${filters.status}` : path)}>
            Clear
          </Button>
        )}
      </Card>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-[13px]">
          <span className="text-muted">
            {list.total.toLocaleString("en-NG")} expense{list.total === 1 ? "" : "s"}
          </span>
          <span className="tabular ml-auto font-semibold">Total {naira(list.sumKobo)}</span>
        </div>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={<ReceiptText />}
            title={filtered || filters.status ? "Nothing here" : "No expenses yet"}
            action={
              !filtered && !filters.status ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus /> Record the first expense
                </Button>
              ) : undefined
            }
          >
            {filtered || filters.status
              ? "Try another tab or clear the filters."
              : "Record diesel, salaries, repairs and every other payment, with the receipt attached."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Paid to</Th>
                <Th className="max-md:hidden">Category</Th>
                <Th className="max-lg:hidden">Raised by</Th>
                <Th num>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => {
                const st = EXPENSE_STATUS[r.status]!;
                const mine = r.status === "submitted" && canApprove && r.requestedBy !== userId;
                return (
                  <Tr key={r.id} className={r.status === "void" ? "opacity-60" : undefined}>
                    <Td className="whitespace-nowrap">
                      {formatDate(r.spentOn)}
                      <div className="font-mono text-xs text-faint">{r.expenseNo}</div>
                    </Td>
                    <Td>
                      <Link href={`/expenses/${r.id}`} className="font-medium hover:text-accent">
                        {r.payee}
                      </Link>
                      <div className="line-clamp-1 text-xs text-muted">
                        {r.description}
                        {branches.length > 1 && <span className="text-faint"> · {r.branchName}</span>}
                      </div>
                    </Td>
                    <Td className="max-md:hidden">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-sm" style={{ background: COLOR_VAR[r.categoryColor] }} />
                        {r.categoryName}
                      </span>
                      {r.fundName && <div className="text-xs text-faint">From {r.fundName}</div>}
                    </Td>
                    <Td className="text-muted max-lg:hidden">{r.requestedByName}</Td>
                    <Td num>
                      <span className={r.status === "void" ? "line-through" : "font-medium"}>{naira(r.amountKobo)}</span>
                      <div className="flex items-center justify-end gap-1">
                        {r.files > 0 && (
                          <span className="flex items-center text-xs text-faint" title={`${r.files} file${r.files === 1 ? "" : "s"} attached`}>
                            <Paperclip className="size-3" />
                            {r.files}
                          </span>
                        )}
                        <Badge tone={mine ? "accent" : st.tone}>{mine ? "Your approval" : st.label}</Badge>
                      </div>
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
      <ExpenseDialog
        open={creating}
        onOpenChange={setCreating}
        branches={branches}
        categories={categories}
        funds={funds}
        thresholdKobo={thresholdKobo}
      />
    </>
  );
}
