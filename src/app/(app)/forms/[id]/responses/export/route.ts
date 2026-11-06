import ExcelJS from "exceljs";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { exportResponses } from "@/server/services/forms";

const risky = /^[=+\-@\t\r]/;
const safe = (v: unknown) => (typeof v === "number" ? v : risky.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.can("forms.manage")) return new Response("Your role doesn't allow this.", { status: 403 });
  const { title, rows } = await withOrg(ctx.org.id, (tx) => exportResponses(tx, ctx, id));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Responses", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { Submitted: "" });
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(14, c.length + 2)) }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  const name = title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "responses";
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
