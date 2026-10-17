import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ScheduleSnapshot } from "../db/schema";
import { formatDate } from "@/lib/format";
import { itemClock, to12 } from "@/lib/schedule";

/** Built-in PDF fonts can't print characters outside Latin-1 (₦, curly quotes, emoji); swap them for safe ones. */
const safe = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/₦/g, "NGN ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "");

const INK = "#0e1a33";
const MUTED = "#56637e";
const LINE = "#e2e7f0";

// Note: no lineHeight on the page itself; with it, react-pdf drops the fixed footer.
const makeStyles = (BLUE: string) => StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 40, paddingBottom: 60, fontSize: 9.5, fontFamily: "Helvetica", color: INK },
  head: { flexDirection: "row", alignItems: "center", gap: 10, borderBottom: `2pt solid ${BLUE}`, paddingBottom: 10 },
  logo: { width: 34, height: 34, objectFit: "contain" },
  church: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  type: { marginTop: 16, fontSize: 8, color: BLUE, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 3 },
  facts: { flexDirection: "row", flexWrap: "wrap", marginTop: 12, backgroundColor: "#f4f6fb", borderRadius: 4, padding: 10 },
  fact: { width: "50%", paddingVertical: 3, paddingRight: 8 },
  label: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 1 },
  bold: { fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6 },
  th: { flexDirection: "row", backgroundColor: BLUE, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 5, paddingHorizontal: 6 },
  tr: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottom: `0.5pt solid ${LINE}` },
  cTime: { width: "15%" },
  cItem: { width: "50%", paddingRight: 8 },
  cWho: { width: "35%" },
  desc: { color: MUTED, fontSize: 8.5, marginTop: 2, lineHeight: 1.35 },
  note: { marginTop: 4, padding: 10, border: `0.5pt solid ${LINE}`, borderRadius: 4, lineHeight: 1.4 },
  foot: { position: "absolute", bottom: 26, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#8792aa", borderTop: `0.5pt solid ${LINE}`, paddingTop: 6 },
  stamp: { position: "absolute", top: 36, right: 40, fontSize: 8, color: "#b45309", border: "1pt solid #b45309", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
});
const defaultStyles = makeStyles("#2357e8");

export async function renderSchedulePdf(o: {
  snap: ScheduleSnapshot;
  church: string;
  logo?: Buffer | null;
  /** The church colour; defaults to Build My Church blue. */
  accent?: string;
  version: number | null;
  publishedAt?: Date | null;
  publishedBy?: string | null;
  typeLabel: string;
}) {
  const s = o.accent ? makeStyles(o.accent) : defaultStyles;
  const { snap } = o;
  const clock = itemClock(snap.startTime, snap.items);
  const when = `${formatDate(snap.serviceDate, "long")}, ${to12(snap.startTime)}${snap.endTime ? ` - ${to12(snap.endTime)}` : ""}`;
  const generated = o.version
    ? `Version ${o.version}${o.publishedAt ? ` · Published ${formatDate(o.publishedAt)}` : ""}${o.publishedBy ? ` by ${safe(o.publishedBy)}` : ""}`
    : "Preview: not yet published";
  const doc = (
    <Document title={safe(`${snap.title} - ${formatDate(snap.serviceDate)}`)} author={safe(o.church)} creator="Build My Church">
      <Page size="A4" style={s.page} wrap>
        <View style={s.foot} fixed>
          <Text>{safe(generated)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
        {!o.version && (
          <Text style={s.stamp} fixed>
            DRAFT PREVIEW
          </Text>
        )}
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt */}
          {o.logo ? <Image style={s.logo} src={o.logo} /> : null}
          <View>
            <Text style={s.church}>{safe(o.church)}</Text>
            <Text style={s.muted}>{safe(snap.branchName)}</Text>
          </View>
        </View>
        <Text style={s.type}>{safe(o.typeLabel)}</Text>
        <Text style={s.title}>{safe(snap.title)}</Text>
        <View style={s.facts}>
          <View style={s.fact}>
            <Text style={s.label}>Date and time</Text>
            <Text style={s.bold}>{safe(when)}</Text>
          </View>
          {snap.venue ? (
            <View style={s.fact}>
              <Text style={s.label}>Venue</Text>
              <Text style={s.bold}>{safe(snap.venue)}</Text>
            </View>
          ) : null}
          {snap.theme ? (
            <View style={s.fact}>
              <Text style={s.label}>Theme</Text>
              <Text>{safe(snap.theme)}</Text>
            </View>
          ) : null}
          {snap.scripture ? (
            <View style={s.fact}>
              <Text style={s.label}>Scripture</Text>
              <Text>{safe(snap.scripture)}</Text>
            </View>
          ) : null}
          {snap.presidingName ? (
            <View style={s.fact}>
              <Text style={s.label}>Presiding</Text>
              <Text>{safe(snap.presidingName)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={s.h2}>Order of service</Text>
        <View style={s.th}>
          <Text style={s.cTime}>Time</Text>
          <Text style={s.cItem}>Programme</Text>
          <Text style={s.cWho}>Ministering</Text>
        </View>
        {snap.items.map((it, i) => (
          <View key={it.id} style={s.tr} wrap={false}>
            <View style={s.cTime}>
              <Text style={s.bold}>{to12(clock[i]!.start)}</Text>
              {it.durationMin ? <Text style={s.desc}>{it.durationMin} min</Text> : null}
            </View>
            <View style={s.cItem}>
              <Text style={s.bold}>{safe(it.title)}</Text>
              {it.description ? <Text style={s.desc}>{safe(it.description)}</Text> : null}
              {it.custom.map((c, k) => (
                <Text key={k} style={s.desc}>
                  {safe(c.label)}: {safe(c.value)}
                </Text>
              ))}
            </View>
            <View style={s.cWho}>
              {it.assignees.length ? (
                it.assignees.map((a) => (
                  <Text key={a.key}>
                    {safe(a.name)}
                    {a.responsibility ? <Text style={s.muted}> ({safe(a.responsibility)})</Text> : null}
                  </Text>
                ))
              ) : (
                <Text style={s.muted}>-</Text>
              )}
            </View>
          </View>
        ))}

        {snap.announcements ? (
          <View wrap={false}>
            <Text style={s.h2}>Announcements and instructions</Text>
            <View style={s.note}>
              <Text>{safe(snap.announcements)}</Text>
            </View>
          </View>
        ) : null}


      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
