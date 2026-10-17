/** Schedule time helpers, shared by the editor (live preview), the server (validation) and the PDF. */

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
export const fromMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const isHHMM = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** "13:30" → "1:30 PM". */
export const to12 = (hhmm: string | null | undefined) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * When each item starts and ends: its own start time if it has one, otherwise straight after the item before.
 * An item with no duration leaves the next item's time unknown unless that item sets its own.
 */
export function itemClock(startTime: string, items: { startTime?: string | null; durationMin?: number | null }[]) {
  let clock: number | null = isHHMM(startTime) ? toMin(startTime) : null;
  return items.map((i) => {
    const start = i.startTime && isHHMM(i.startTime) ? toMin(i.startTime) : clock;
    const end = start !== null && i.durationMin ? start + i.durationMin : null;
    clock = end;
    return { start: start === null ? null : fromMin(start), end: end === null ? null : fromMin(end), startMin: start, endMin: end };
  });
}

/** Problems with the times, keyed by field path, e.g. "items.3.startTime". */
export function timeProblems(s: {
  startTime: string;
  endTime?: string | null;
  items: { title: string; startTime?: string | null; durationMin?: number | null }[];
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isHHMM(s.startTime)) out.startTime = "Enter a start time.";
  if (s.endTime && isHHMM(s.startTime) && isHHMM(s.endTime) && toMin(s.endTime) <= toMin(s.startTime))
    out.endTime = "The service has to end after it starts.";
  if (out.startTime) return out;
  const clock = itemClock(s.startTime, s.items);
  const serviceStart = toMin(s.startTime);
  const serviceEnd = s.endTime && isHHMM(s.endTime) ? toMin(s.endTime) : null;
  let prevEnd: number | null = null;
  let prevTitle = "";
  s.items.forEach((it, i) => {
    const c = clock[i]!;
    if (it.durationMin != null && (!Number.isInteger(it.durationMin) || it.durationMin <= 0 || it.durationMin > 720))
      out[`items.${i}.durationMin`] = "Use whole minutes, from 1 to 720.";
    if (it.startTime && !isHHMM(it.startTime)) out[`items.${i}.startTime`] = "Use a time like 08:30.";
    else if (c.startMin !== null && c.startMin < serviceStart)
      out[`items.${i}.startTime`] = `Starts before the service does (${to12(s.startTime)}).`;
    else if (it.startTime && prevEnd !== null && c.startMin !== null && c.startMin < prevEnd)
      out[`items.${i}.startTime`] = `Starts before "${prevTitle}" ends at ${to12(fromMin(prevEnd))}.`;
    if (serviceEnd !== null && c.endMin !== null && c.endMin > serviceEnd && !out[`items.${i}.durationMin`])
      out[`items.${i}.durationMin`] = `Runs past the end of the service (${to12(s.endTime)}).`;
    if (c.endMin !== null) {
      prevEnd = c.endMin;
      prevTitle = it.title;
    } else if (c.startMin !== null) {
      prevEnd = c.startMin;
      prevTitle = it.title;
    }
  });
  return out;
}
