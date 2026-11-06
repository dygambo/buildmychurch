import ExcelJS from "exceljs";
import Papa from "papaparse";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { exportTransactions, type TxFilters } from "@/server/services/giving";
import { rateLimit } from "@/server/rate-limit";

/** Spreadsheet cells that start with these characters can run as formulas when opened. */
const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => (typeof v === "number" ? v : risky.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to export giving records.", { status: 401 });
  if (!ctx.can("giving.read")) return new Response("Your role doesn't allow exporting giving records.", { status: 403 });
  if (!(await rateLimit(`giving-export:${ctx.user.id}`, 20, 3600)))
    return new Response("Too many exports in the last hour. Try again later.", { status: 429 });
  const sp = new URL(req.url).searchParams;
  const get = (k: string) => sp.get(k) || undefined;
  const filters: TxFilters = {
    q: get("q"),
    from: get("from"),
    to: get("to"),
    fundId: get("fund"),
    channel: get("channel"),
    status: get("status"),
    source: get("source"),
    branchId: get("branch"),
  };
  const rows = await withOrg(ctx.org.id, (tx) => exportTransactions(tx, ctx, filters));
  const base = `${ctx.org.slug}-giving-${new Date().toISOString().slice(0, 10)}`;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (sp.get("format") === "csv") {
    const csv = Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
    return new Response("﻿" + csv, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
    });
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "Build My Church";
  const ws = wb.addWorksheet("Giving", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { Date: "" });
  ws.columns = cols.map((c) => ({
    header: c,
    key: c,
    width: Math.max(12, Math.min(36, c.length + 6)),
    style: c.includes("(₦)") ? { numFmt: "#,##0.00" } : undefined,
  }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  if (rows.length) {
    const total = ws.addRow({});
    total.getCell(1).value = "Total";
    for (const c of ["Amount (₦)", "Fee (₦)", "Net (₦)"]) {
      const idx = cols.indexOf(c) + 1;
      const letter = ws.getColumn(idx).letter;
      total.getCell(idx).value = { formula: `SUM(${letter}2:${letter}${rows.length + 1})` };
    }
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
