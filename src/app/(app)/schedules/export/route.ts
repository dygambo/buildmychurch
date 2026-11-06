import ExcelJS from "exceljs";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { exportSchedules, type ScheduleFilters } from "@/server/services/schedules";

const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => (typeof v === "number" ? v : risky.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));

/** Every programme item of the filtered schedules, one row each, as Excel. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to export schedules.", { status: 401 });
  if (!ctx.can("schedules.manage")) return new Response("Your role doesn't allow exporting schedules.", { status: 403 });
  if (!(await rateLimit(`schedule-export:${ctx.user.id}`, 20, 3600))) return new Response("Too many exports in the last hour.", { status: 429 });
  const sp = new URL(req.url).searchParams;
  const get = (k: string) => sp.get(k) || undefined;
  const f: ScheduleFilters = { q: get("q"), from: get("from"), to: get("to"), type: get("type"), status: get("status"), person: get("person"), venue: get("venue") };
  const rows = await withOrg(ctx.org.id, (tx) => exportSchedules(tx, ctx, f));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Build My Church";
  const ws = wb.addWorksheet("Schedules", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { Date: "" });
  ws.columns = cols.map((c) => ({ header: c, key: c, width: c === "Item" || c === "Service" || c === "Assigned" ? 30 : 13 }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ctx.org.slug}-schedules-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
