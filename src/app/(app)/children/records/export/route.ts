import Papa from "papaparse";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { audit } from "@/server/audit";
import { checkinRows } from "@/server/services/children";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const when = (d: Date | null) => (d ? fmt.format(d).replace(",", "") : "");
const safe = (v: unknown) => {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.can("children.manage")) return new Response("Your role can't export children's records.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = isDate(sp.get("from")) ? sp.get("from")! : undefined;
  const to = isDate(sp.get("to")) ? sp.get("to")! : undefined;
  const child = sp.get("child") ?? undefined;
  const rows = await withOrg(ctx.org.id, async (tx) => {
    const r = await checkinRows(tx, ctx, {
      from,
      to,
      childId: child && /^[0-9a-f-]{36}$/i.test(child) ? child : undefined,
      limit: 50000,
    });
    await audit(tx, ctx, {
      action: "child.records_exported",
      summary: `Exported ${r.length} children's check-in records${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`,
      entityType: "child",
    });
    return r;
  });
  const csv = Papa.unparse(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries({
          "Child no": r.childNo,
          Child: r.child,
          Class: r.classGroup,
          Service: r.service,
          "Checked in (WAT)": when(r.checkedInAt),
          "Checked in by": r.checkedInByName,
          "Dropped off by": r.droppedOffBy,
          "Check-in method": r.checkInMethod,
          "Checked out (WAT)": when(r.checkedOutAt),
          "Checked out by": r.checkedOutByName,
          "Picked up by": r.pickedUpBy,
          "Check-out method": r.checkOutMethod,
          "Override reason": r.overrideReason,
        }).map(([k, v]) => [k, safe(v)]),
      ),
    ),
  );
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="children-checkins-${from ?? "all"}-to-${to ?? "now"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
