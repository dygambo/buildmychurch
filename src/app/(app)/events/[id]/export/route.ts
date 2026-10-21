import ExcelJS from "exceljs";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { exportRegistrations } from "@/server/services/events";

const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => (typeof v === "number" ? v : risky.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.can("events.manage")) return new Response("Your role doesn't allow this.", { status: 403 });
  const rows = await withOrg(ctx.org.id, (tx) => exportRegistrations(tx, ctx, id));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Registrations", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { Name: "" });
  ws.columns = cols.map((c) => ({ header: c, key: c, width: c === "Name" || c === "Email" ? 28 : 14 }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="registrations-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
