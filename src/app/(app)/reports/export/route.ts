import ExcelJS from "exceljs";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { listBranches } from "@/server/services/org";
import { reportWorkbook } from "@/server/services/reports";
import { resolvePeriod } from "@/lib/periods";

const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => (typeof v === "number" ? v : v === null || v === undefined ? "" : risky.test(String(v)) ? `'${v}` : String(v));

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.can("reports.read")) return new Response("Your role doesn't allow this.", { status: 403 });
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const period = resolvePeriod(q);
  const sheets = await withOrg(ctx.org.id, async (tx) => {
    const branches = await listBranches(tx);
    const branchId = branches.some((b) => b.id === q.branch) ? q.branch! : null;
    return reportWorkbook(tx, ctx, { ...period, branchId });
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = "Build My Church";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    const cols = Object.keys(s.rows[0] ?? { "No data": "" });
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(44, Math.max(12, c.length + 4)) }));
    s.rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
    ws.getRow(1).font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="church-report-${period.from}-to-${period.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
