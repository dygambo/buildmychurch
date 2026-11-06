import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import type { memberGiving } from "../services/giving";

// Built-in PDF fonts have no naira sign, so statements write "NGN".
const money = (kobo: number) =>
  `NGN ${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontSize: 9.5, fontFamily: "Helvetica", color: "#0e1a33" },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottom: "2pt solid #2357e8", paddingBottom: 10 },
  church: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: "#56637e" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 18 },
  box: { flexDirection: "row", gap: 24, backgroundColor: "#f4f6fb", padding: 10, borderRadius: 4, marginTop: 12 },
  label: { fontSize: 7.5, color: "#56637e", textTransform: "uppercase", marginBottom: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", backgroundColor: "#2357e8", color: "#ffffff", fontFamily: "Helvetica-Bold", padding: 5, marginTop: 14 },
  tr: { flexDirection: "row", padding: 5, borderBottom: "0.5pt solid #e2e7f0" },
  c1: { width: "16%" },
  c2: { width: "26%" },
  c3: { width: "16%" },
  c4: { width: "22%" },
  c5: { width: "20%", textAlign: "right" },
  totals: { marginTop: 14, alignSelf: "flex-end", width: "52%" },
  trow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottom: "0.5pt solid #e2e7f0" },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, fontFamily: "Helvetica-Bold", fontSize: 11 },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#8792aa" },
});

const CH: Record<string, string> = { cash: "Cash", pos: "POS", transfer: "Transfer", cheque: "Cheque", online: "Online", other: "Other" };

type G = Awaited<ReturnType<typeof memberGiving>>;

/** The annual giving statement, for staff downloads and the member page. */
export async function renderStatement({ o, name, memberNo, g, logo, accent }: { o: { name: string; address: string | null; phone: string | null; email: string | null }; name: string; memberNo: string; g: G; logo?: Buffer | null; accent?: string }) {
  const color = accent ?? "#2357e8";
  const year = g.year;
  const m = { memberNo };
  const generated = formatDate(new Date(), "long");
  const doc = (
    <Document title={`${year} giving statement - ${name}`} author={o.name} creator="Build My Church">
      <Page size="A4" style={s.page}>
        <View style={[s.head, { borderBottomColor: color }]} fixed>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logo ? <Image style={{ width: 38, height: 38, objectFit: "contain" }} src={logo} /> : null}
            <View>
            <Text style={s.church}>{o.name}</Text>
            {o.address && <Text style={s.muted}>{o.address}</Text>}
            <Text style={s.muted}>{[o.phone?.replace("+234", "0"), o.email].filter(Boolean).join("  |  ")}</Text>
            </View>
          </View>
          <Text style={[s.muted, { textAlign: "right" }]}>GIVING STATEMENT{"\n"}{year}</Text>
        </View>
        <Text style={s.title}>Giving statement for {year}</Text>
        <View style={s.box}>
          <View>
            <Text style={s.label}>Member</Text>
            <Text style={s.bold}>{name}</Text>
          </View>
          <View>
            <Text style={s.label}>Member number</Text>
            <Text style={s.bold}>{m.memberNo}</Text>
          </View>
          <View>
            <Text style={s.label}>Period</Text>
            <Text style={s.bold}>1 January to 31 December {year}</Text>
          </View>
          <View>
            <Text style={s.label}>Total given</Text>
            <Text style={s.bold}>{money(g.total)}</Text>
          </View>
        </View>
        <View style={[s.th, { backgroundColor: color }]} fixed>
          <Text style={s.c1}>Date</Text>
          <Text style={s.c2}>Fund</Text>
          <Text style={s.c3}>Method</Text>
          <Text style={s.c4}>Receipt / reference</Text>
          <Text style={s.c5}>Amount</Text>
        </View>
        {g.rows.length === 0 ? (
          <Text style={[s.muted, { padding: 8 }]}>No gifts were recorded for {year}.</Text>
        ) : (
          g.rows.map((r) => (
            <View key={r.id} style={s.tr} wrap={false}>
              <Text style={s.c1}>{formatDate(r.givenOn)}</Text>
              <Text style={s.c2}>
                {r.fundName}
                {r.reversalOf ? " (reversal)" : ""}
              </Text>
              <Text style={s.c3}>{CH[r.channel] ?? r.channel}</Text>
              <Text style={[s.c4, { fontSize: 8 }]}>{r.receiptNo ?? r.reference}</Text>
              <Text style={s.c5}>{money(r.amountKobo)}</Text>
            </View>
          ))
        )}
        <View style={s.totals} wrap={false}>
          {g.byFund.map((f) => (
            <View key={f.fund} style={s.trow}>
              <Text>{f.fund}</Text>
              <Text>{money(f.amount)}</Text>
            </View>
          ))}
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{money(g.total)}</Text>
          </View>
        </View>
        <Text style={[s.muted, { marginTop: 18, fontSize: 8.5 }]}>
          This statement lists the gifts {o.name} recorded against your name in {year}. Reversed gifts appear with their
          reversal, so they cancel out. If something looks wrong, contact the church office.
        </Text>
        <View style={s.foot} fixed>
          <Text>Generated {generated} by Build My Church</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
