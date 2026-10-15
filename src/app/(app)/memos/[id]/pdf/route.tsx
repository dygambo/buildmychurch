import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { getMemo } from "@/server/services/memos";
import { formatDate, formatDateTime } from "@/lib/format";

const safe = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/₦/g, "NGN ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/→/g, ">")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "");
const money = (k: number) => `NGN ${(k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

const s = StyleSheet.create({
  page: { padding: 44, paddingBottom: 60, fontSize: 10, fontFamily: "Helvetica", color: "#0e1a33" },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottom: "2pt solid #2357e8", paddingBottom: 10 },
  kicker: { fontSize: 8, color: "#2357e8", fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  church: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  ref: { fontSize: 9, fontFamily: "Courier" },
  row: { flexDirection: "row", marginTop: 4 },
  k: { width: 70, color: "#56637e" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 8 },
  body: { lineHeight: 1.5 },
  stamps: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 24 },
  stamp: { width: 120, padding: 8, border: "2pt solid #16a34a", borderRadius: 8, color: "#15803d", alignItems: "center" },
  sBig: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.5 },
  sName: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 3, textAlign: "center" },
  sSmall: { fontSize: 7, marginTop: 1, textAlign: "center" },
  foot: { position: "absolute", bottom: 26, left: 44, right: 44, fontSize: 7.5, color: "#8792aa", flexDirection: "row", justifyContent: "space-between" },
});

/** The memo as a printable document, with a stamp for each approval. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to download this memo.", { status: 401 });
  try {
    const m = await withOrg(ctx.org.id, async (tx) => {
      const memo = await getMemo(tx, ctx, id);
      await audit(tx, ctx, { action: "memo.downloaded", summary: `Downloaded memo ${memo.refNo ?? memo.title} as PDF`, entityType: "memo", entityId: id });
      return memo;
    });
    const doc = (
      <Document title={safe(m.refNo ?? m.title)} author={safe(ctx.org.name)} creator="Build My Church">
        <Page size="A4" style={s.page}>
          <View style={s.head}>
            <View>
              <Text style={s.kicker}>INTERNAL MEMO{m.confidential ? " - CONFIDENTIAL" : ""}</Text>
              <Text style={s.church}>{safe(ctx.org.name)}</Text>
            </View>
            <Text style={s.ref}>{safe(m.refNo ?? "DRAFT")}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <View style={s.row}>
              <Text style={s.k}>From</Text>
              <Text>{safe(`${m.initiatorName}${m.departmentName ? `, ${m.departmentName}` : ""}`)}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.k}>To</Text>
              <Text>{safe(m.steps.map((x) => x.label).join(" > ") || "-")}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.k}>Date</Text>
              <Text>{formatDate(m.submittedAt ?? m.createdAt, "long")}</Text>
            </View>
            {m.amountKobo ? (
              <View style={s.row}>
                <Text style={s.k}>Amount</Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{money(m.amountKobo)}</Text>
              </View>
            ) : null}
            <View style={s.row}>
              <Text style={s.k}>Status</Text>
              <Text>{m.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={s.title}>{safe(m.title)}</Text>
          <Text style={s.body}>{safe(m.body)}</Text>
          <View style={s.stamps} wrap={false}>
            {m.steps
              .filter((x) => x.stamp)
              .map((x) => (
                <View key={x.id} style={s.stamp}>
                  <Text style={s.sBig}>APPROVED</Text>
                  <Text style={s.sName}>{safe(x.stamp!.name)}</Text>
                  <Text style={s.sSmall}>{safe(x.stamp!.label.toUpperCase())}</Text>
                  <Text style={s.sSmall}>{formatDateTime(x.stamp!.at)}</Text>
                  <Text style={[s.sSmall, { fontFamily: "Courier" }]}>{x.stamp!.code}</Text>
                </View>
              ))}
          </View>
          {m.disbursedAt ? (
            <Text style={{ marginTop: 16, color: "#56637e" }}>
              {safe(`Paid ${money(m.disbursedKobo!)} on ${formatDate(m.disbursedAt)} by ${m.disbursedByName}${m.disbursementRef ? ` (ref ${m.disbursementRef})` : ""}.`)}
            </Text>
          ) : null}
          <View style={s.foot} fixed>
            <Text>Stamp codes are recorded in the memo's audit trail in Build My Church.</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      </Document>
    );
    const buf = await renderToBuffer(doc);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${(m.refNo ?? "memo").replace(/[^A-Za-z0-9-]/g, "-")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
