import ExcelJS from "exceljs";
import Papa from "papaparse";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { exportExpenses, type ExpenseFilters } from "@/server/services/expenses";
import { rateLimit } from "@/server/rate-limit";

/** Spreadsheet cells that start with these characters can run as formulas when opened. */
const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => (typeof v === "number" ? v : risky.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to export expenses.", { status: 401 });
  if (!ctx.can("finance.expenses")) return new Response("Your role doesn't allow exporting expenses.", { status: 403 });
  if (!(await rateLimit(`expense-export:${ctx.user.id}`, 20, 3600)))
    return new Response("Too many exports in the last hour. Try again later.", { status: 429 });
  const sp = new URL(req.url).searchParams;
  const get = (k: string) => sp.get(k) || undefined;
  const filters: ExpenseFilters = {
    q: get("q"),
    status: get("status"),
    categoryId: get("category"),
    branchId: get("branch"),
    fundId: get("fund"),
    from: get("from"),
    to: get("to"),
  };
  const rows = await withOrg(ctx.org.id, (tx) => exportExpenses(tx, ctx, filters));
  const base = `${ctx.org.slug}-expenses-${new Date().toISOString().slice(0, 10)}`;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (sp.get("format") === "csv") {
    const csv = Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
    return new Response("﻿" + csv, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
    });
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "Build My Church";
  const ws = wb.addWorksheet("Expenses", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { Number: "" });
  ws.columns = cols.map((c) => ({
    header: c,
    key: c,
    width: c === "Description" ? 40 : Math.max(12, Math.min(30, c.length + 8)),
    style: c.includes("(₦)") ? { numFmt: "#,##0.00" } : undefined,
  }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  if (rows.length) {
    const idx = cols.indexOf("Amount (₦)") + 1;
    const letter = ws.getColumn(idx).letter;
    const total = ws.addRow({});
    total.getCell(1).value = "Total (excluding voided)";
    const st = ws.getColumn(cols.indexOf("Status") + 1).letter;
    total.getCell(idx).value = { formula: `SUMIF(${st}2:${st}${rows.length + 1},"<>Voided",${letter}2:${letter}${rows.length + 1})` };
    total.font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
