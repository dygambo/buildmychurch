const TZ = "Africa/Lagos";

/** Kobo → "₦1,250,000" (or with kobo when present). */
export function naira(kobo: number, opts: { compact?: boolean } = {}): string {
  const n = kobo / 100;
  if (opts.compact) {
    const a = Math.abs(n);
    const t = (x: number, d: number) => x.toFixed(d).replace(/\.0$/, "");
    if (a >= 1e9) return "₦" + t(n / 1e9, 1) + "bn";
    if (a >= 1e6) return "₦" + t(n / 1e6, a >= 1e8 ? 0 : 1) + "m";
    if (a >= 1e3) return "₦" + Math.round(n / 1e3) + "k";
  }
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export const num = (n: number) => n.toLocaleString("en-NG");

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o });
const dShort = fmt({ day: "numeric", month: "short" });
const dYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const dLong = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dWeek = fmt({ weekday: "short", day: "numeric", month: "short" });
const tShort = fmt({ hour: "numeric", minute: "2-digit", hour12: true });

const toDate = (d: Date | string) =>
  typeof d === "string" ? new Date(d.length === 10 ? d + "T12:00:00+01:00" : d) : d;

/** Today's date in Lagos as YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}
export function formatDate(d: Date | string, style: "short" | "year" | "long" | "week" = "year"): string {
  const x = toDate(d);
  return { short: dShort, year: dYear, long: dLong, week: dWeek }[style].format(x);
}
export function formatTime(d: Date | string): string {
  return tShort.format(toDate(d)).replace(" ", " ").toUpperCase();
}
export function formatDateTime(d: Date | string): string {
  return `${formatDate(d, "year")}, ${formatTime(d)}`;
}
/** "3 days ago", "today" — relative to Lagos time. */
export function timeAgo(d: Date | string, now = new Date()): string {
  const x = toDate(d).getTime();
  const s = Math.round((now.getTime() - x) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
export const fullName = (p: { title?: string | null; firstName: string; lastName: string }, withTitle = true) =>
  [withTitle ? p.title : null, p.firstName, p.lastName].filter(Boolean).join(" ");
/** Honorifics common in Nigerian churches; stripped when we need someone's actual name. */
const TITLE_RE =
  /^((Pst|Pastor|Rev|Reverend|Apostle|Bishop|Evangelist|Prophet(ess)?|Bro|Brother|Sis|Sister|Dr|Prof|Mr|Mrs|Ms|Miss|Deacon(ess)?|Elder|Chief|Engr|Barr|Hon)\.?\s+)+/i;
export const stripTitles = (name: string) => name.replace(TITLE_RE, "").trim() || name;
export const firstName = (name: string) => stripTitles(name).split(/\s+/)[0] ?? name;
export const initials = (name: string) =>
  stripTitles(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
