"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLOR_VAR, toKobo, toNairaInput } from "../../giving/labels";
import { saveBudgetAction } from "../actions";

type Line = { categoryId: string; name: string; color: string; budget: number; actual: number; lastYear: number };

export function BudgetView({
  year,
  thisYear,
  branchId,
  branches,
  lines,
}: {
  year: number;
  thisYear: number;
  branchId: string;
  branches: { id: string; name: string }[];
  lines: Line[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.categoryId, toNairaInput(l.budget)])),
  );
  const save = useAction(saveBudgetAction, { onSuccess: () => router.refresh() });
  const dirty = lines.some((l) => toKobo(values[l.categoryId] ?? "") !== l.budget);
  const totals = useMemo(
    () => ({
      budget: lines.reduce((s, l) => s + toKobo(values[l.categoryId] ?? ""), 0),
      actual: lines.reduce((s, l) => s + l.actual, 0),
      lastYear: lines.reduce((s, l) => s + l.lastYear, 0),
    }),
    [lines, values],
  );
  const go = (y: number, b: string) => router.replace(`/expenses/budgets?year=${y}&branch=${b}`);
  const elapsed = year < thisYear ? 1 : year > thisYear ? 0 : (new Date().getMonth() + 1) / 12;
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  return (
    <>
      <PageHeader
        title="Budgets"
        description="What each category is expected to cost this year, against what has actually been paid."
        actions={
          <>
            {branches.length > 1 && (
              <Select aria-label="Branch" value={branchId} onChange={(e) => go(year, e.target.value)} className="w-44">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
            <Select aria-label="Year" value={year} onChange={(e) => go(Number(e.target.value), branchId)} className="w-28">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th num className="max-md:hidden">
                Spent in {year - 1}
              </Th>
              <Th num className="w-44">
                Budget {year} (₦)
              </Th>
              <Th num>Spent so far</Th>
              <Th num className="max-sm:hidden">
                Left
              </Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const b = toKobo(values[l.categoryId] ?? "");
              const pct = b ? l.actual / b : 0;
              const ahead = b > 0 && pct > elapsed + 0.05;
              return (
                <Tr key={l.categoryId}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-sm" style={{ background: COLOR_VAR[l.color] }} />
                      {l.name}
                    </span>
                  </Td>
                  <Td num className="text-muted max-md:hidden">
                    {l.lastYear ? (
                      <button
                        type="button"
                        className="tabular hover:text-accent"
                        title="Use last year's spending as this year's budget"
                        onClick={() => setValues((v) => ({ ...v, [l.categoryId]: toNairaInput(l.lastYear) }))}
                      >
                        {naira(l.lastYear)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td num>
                    <Input
                      aria-label={`${l.name} budget`}
                      inputMode="decimal"
                      className="tabular h-8 text-right"
                      value={values[l.categoryId] ?? ""}
                      placeholder="0"
                      onChange={(e) => setValues((v) => ({ ...v, [l.categoryId]: e.target.value }))}
                      onBlur={(e) => setValues((v) => ({ ...v, [l.categoryId]: toNairaInput(toKobo(e.target.value)) }))}
                    />
                  </Td>
                  <Td num>
                    <span className={cn(pct > 1 ? "text-bad" : ahead ? "text-warn" : undefined, "font-medium")}>{naira(l.actual)}</span>
                    {b > 0 && <div className="text-xs text-faint">{Math.round(pct * 100)}%</div>}
                  </Td>
                  <Td num className={cn("max-sm:hidden", b - l.actual < 0 ? "text-bad" : "text-muted")}>
                    {b ? naira(b - l.actual) : "—"}
                  </Td>
                </Tr>
              );
            })}
            <Tr className="font-semibold">
              <Td>Total</Td>
              <Td num className="max-md:hidden">
                {naira(totals.lastYear)}
              </Td>
              <Td num data-testid="budget-total">
                {naira(totals.budget)}
              </Td>
              <Td num>{naira(totals.actual)}</Td>
              <Td num className="max-sm:hidden">
                {naira(totals.budget - totals.actual)}
              </Td>
            </Tr>
          </tbody>
        </Table>
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">
          <span className="text-[13px] text-muted">
            Orange means spending is ahead of where the year is; red means over budget.
          </span>
          <span className="ml-auto flex gap-2">
            {totals.lastYear > 0 && (
              <Button
                variant="ghost"
                onClick={() => setValues(Object.fromEntries(lines.map((l) => [l.categoryId, toNairaInput(l.lastYear)])))}
              >
                <Copy /> Start from {year - 1}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!dirty}
              loading={save.pending}
              onClick={() =>
                save.run({
                  year,
                  branchId,
                  lines: lines.map((l) => ({ categoryId: l.categoryId, amount: String(toKobo(values[l.categoryId] ?? "") / 100) })),
                })
              }
            >
              <Save /> Save budget
            </Button>
          </span>
        </div>
      </Card>
    </>
  );
}
