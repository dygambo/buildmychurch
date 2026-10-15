import ExcelJS from "exceljs";
import Papa from "papaparse";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { exportRows, type MemberFilters } from "@/server/services/members";
import { rateLimit } from "@/server/rate-limit";

/** Spreadsheet cells that start with these characters can run as formulas when opened. */
const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => {
  const s = String(v ?? "");
  return risky.test(s) ? `'${s}` : s;
};

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to export members.", { status: 401 });
  if (!ctx.can("members.export")) return new Response("Your role doesn't allow exporting members.", { status: 403 });
  if (!(await rateLimit(`export:${ctx.user.id}`, 20, 3600)))
    return new Response("Too many exports in the last hour. Try again later.", { status: 429 });

  const sp = new URL(req.url).searchParams;
  const get = (k: string) => sp.get(k) || undefined;
  const filters: MemberFilters = {
    q: get("q"),
    stage: get("stage"),
    status: get("status"),
    branchId: get("branch"),
    groupId: get("group"),
    tagId: get("tag"),
    gender: get("gender"),
    birthdays: get("birthdays") === "week" ? "week" : get("birthdays") === "month" ? "month" : undefined,
  };
  const rows = await withOrg(ctx.org.id, (tx) => exportRows(tx, ctx, filters));
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${ctx.org.slug}-members-${stamp}`;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (sp.get("format") === "csv") {
    const csv = Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
    return new Response("﻿" + csv, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Build My Church";
  const ws = wb.addWorksheet("Members", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { "Member no": "" });
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.max(12, Math.min(40, c.length + 6)) }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
