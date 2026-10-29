import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";

// Built-in PDF fonts cover Latin-1 only.
const safe = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "");

const s = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", color: "#0e1a33" },
  frame: { flex: 1, borderWidth: 3, borderStyle: "solid", padding: 6 },
  inner: { flex: 1, borderWidth: 0.8, borderStyle: "solid", paddingVertical: 34, paddingHorizontal: 48, alignItems: "center" },
  logo: { width: 64, height: 64, objectFit: "contain", marginBottom: 8 },
  church: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "center" },
  address: { fontSize: 9, color: "#56637e", marginTop: 2, textAlign: "center" },
  title: { fontSize: 26, fontFamily: "Times-Bold", marginTop: 26, letterSpacing: 1, textAlign: "center" },
  sub: { fontSize: 11, color: "#56637e", marginTop: 4, letterSpacing: 2 },
  certify: { fontSize: 11, marginTop: 28, color: "#56637e" },
  names: { fontSize: 22, fontFamily: "Times-BoldItalic", marginTop: 10, textAlign: "center" },
  body: { fontSize: 11, marginTop: 16, lineHeight: 1.6, textAlign: "center", maxWidth: 520 },
  signs: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 56 },
  sign: { width: 210, fontSize: 10, borderTopWidth: 0.8, borderTopStyle: "solid", borderTopColor: "#0e1a33", paddingTop: 5, alignItems: "center" },
  signLabel: { fontSize: 9, color: "#56637e" },
  foot: { position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", fontSize: 8, color: "#8792aa" },
});

/** Certificate of completion of pre-marital counselling, in the church's colour and with its logo. */
export async function renderCertificate(d: {
  church: string;
  address: string | null;
  a: string;
  b: string;
  certificateNo: string;
  completedAt: Date;
  weddingDate: string | null;
  sessions: number;
  counsellors: string[];
  logo: Buffer | null;
  accent: string;
}) {
  const doc = (
    <Document title={`Certificate ${d.certificateNo}`} author={safe(d.church)} creator="Build My Church">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={[s.frame, { borderColor: d.accent }]}>
          <View style={[s.inner, { borderColor: d.accent }]}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt */}
            {d.logo ? <Image style={s.logo} src={d.logo} /> : null}
            <Text style={s.church}>{safe(d.church)}</Text>
            {d.address ? <Text style={s.address}>{safe(d.address)}</Text> : null}
            <Text style={[s.title, { color: d.accent }]}>Certificate of Pre-marital Counselling</Text>
            <Text style={s.sub}>{safe(d.certificateNo)}</Text>
            <Text style={s.certify}>This is to certify that</Text>
            <Text style={s.names}>
              {safe(d.a)} and {safe(d.b)}
            </Text>
            <Text style={s.body}>
              have completed pre-marital counselling at {safe(d.church)}
              {d.sessions ? `, attending ${d.sessions} session${d.sessions === 1 ? "" : "s"},` : ""} and have been found ready for marriage
              {d.weddingDate ? `. Their wedding is planned for ${formatDate(d.weddingDate, "long")}` : ""}. We commend them to God and to the church.
            </Text>
            <View style={s.signs}>
              <View style={s.sign}>
                <Text>{safe(d.counsellors.join(" & ") || " ")}</Text>
                <Text style={s.signLabel}>Counsellor{d.counsellors.length > 1 ? "s" : ""}</Text>
              </View>
              <View style={s.sign}>
                <Text>{formatDate(d.completedAt, "long")}</Text>
                <Text style={s.signLabel}>Date</Text>
              </View>
              <View style={s.sign}>
                <Text> </Text>
                <Text style={s.signLabel}>Senior Pastor</Text>
              </View>
            </View>
          </View>
        </View>
        <Text style={s.foot}>Issued with Build My Church. Verify with the church office quoting {safe(d.certificateNo)}.</Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
