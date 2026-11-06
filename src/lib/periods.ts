import { todayISO } from "./format";

export const PRESETS = {
  month: "This month",
  last_month: "Last month",
  quarter: "This quarter",
  year: "This year",
  last_year: "Last year",
  "12m": "Last 12 months",
  custom: "Custom",
} as const;
export type Preset = keyof typeof PRESETS;

export type Period = {
  preset: Preset;
  from: string;
  to: string;
  /** The same length of time just before, for "vs last period". */
  prevFrom: string;
  prevTo: string;
  /** Bucket size for charts: weeks for short periods, months otherwise. */
  bucket: "week" | "month";
  label: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m - 1, d));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isISO = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Turns "?period=quarter" (or from/to) into concrete Lagos dates. */
export function resolvePeriod(input: { period?: string; from?: string; to?: string }, today = todayISO()): Period {
  const [y, m] = today.split("-").map(Number) as [number, number];
  let preset: Preset = input.period && input.period in PRESETS ? (input.period as Preset) : "12m";
  let from: string;
  let to: string;
  switch (preset) {
    case "month":
      from = iso(y, m, 1);
      to = today;
      break;
    case "last_month":
      from = iso(y, m - 1, 1);
      to = iso(y, m, 0);
      break;
    case "quarter": {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      from = iso(y, q, 1);
      to = today;
      break;
    }
    case "year":
      from = iso(y, 1, 1);
      to = today;
      break;
    case "last_year":
      from = iso(y - 1, 1, 1);
      to = iso(y - 1, 12, 31);
      break;
    case "custom":
      if (isISO(input.from) && isISO(input.to) && input.from <= input.to && days(input.from, input.to) <= 3 * 366) {
        from = input.from;
        to = input.to;
        break;
      }
      preset = "12m";
    // falls through
    default:
      from = iso(y, m - 11, 1);
      to = today;
  }
  const len = days(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { preset, from, to, prevFrom, prevTo, bucket: len <= 93 ? "week" : "month", label: preset === "custom" ? `${from} to ${to}` : PRESETS[preset] };
}

const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every bucket start in the period, so charts show empty weeks or months as zero instead of skipping them. */
export function buckets(p: Pick<Period, "from" | "to" | "bucket">): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (p.bucket === "month") {
    let [y, m] = p.from.split("-").map(Number) as [number, number];
    const end = p.to.slice(0, 7);
    for (let i = 0; i < 48; i++) {
      const key = `${y}-${pad(m)}-01`;
      if (key.slice(0, 7) > end) break;
      out.push({ key, label: `${MO[m - 1]}${m === 1 || i === 0 ? ` ${String(y).slice(2)}` : ""}` });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
  // ISO weeks start on Monday, matching Postgres date_trunc('week')
  const d = new Date(`${p.from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (let i = 0; i < 60; i++) {
    const key = d.toISOString().slice(0, 10);
    if (key > p.to) break;
    out.push({ key, label: `${d.getUTCDate()} ${MO[d.getUTCMonth()]}` });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** Percentage change, or null when there's nothing to compare with. */
export const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
