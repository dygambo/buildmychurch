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

/**
 * Date parts in Lagos time, from a numeric formatter. Names are spelled out here rather than taken
 * from Intl, because Node and browsers ship different locale data ("Sep" vs "Sept", narrow spaces),
 * which would make server and browser render different text.
 */
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
  weekday: "short",
});
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MO_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function lagosParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

const toDate = (d: Date | string) =>
  typeof d === "string" ? new Date(d.length === 10 ? d + "T12:00:00+01:00" : d) : d;

/** Today's date in Lagos as YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  const p = lagosParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function formatDate(d: Date | string, style: "short" | "year" | "long" | "week" = "year"): string {
  const p = lagosParts(toDate(d));
  if (style === "short") return `${p.day} ${MO[p.month - 1]}`;
  if (style === "week") return `${WD[p.weekday]} ${p.day} ${MO[p.month - 1]}`;
  if (style === "long") return `${WD_LONG[p.weekday]} ${p.day} ${MO_LONG[p.month - 1]} ${p.year}`;
  return `${p.day} ${MO[p.month - 1]} ${p.year}`;
}
export function formatTime(d: Date | string): string {
  const p = lagosParts(toDate(d));
  const h = p.hour % 12 || 12;
  return `${h}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
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
