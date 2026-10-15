// Recurring jobs are registered here as modules are added.
import { db } from "../db";
import { organisations } from "../db/schema";
import { every } from "./scheduler";
import { enqueue } from "./queue";
import { purgeExpiredSessions } from "../auth/session";

/** Lagos wall-clock parts (UTC+1, no daylight saving). */
export function lagosClock(now: Date) {
  const t = new Date(now.getTime() + 3600_000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), hour: t.getUTCHours() };
}

every(60, async () => {
  await purgeExpiredSessions();
});

// Mondays at 8am: absentee follow-up for every church. The dedupe key makes this run once per church per week.
every(60, async (now) => {
  const c = lagosClock(now);
  if (c.weekday !== 1 || c.hour !== 8) return;
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const o of orgs)
    await enqueue(db, "followup.absentees", {}, { orgId: o.id, dedupeKey: `absentees:${o.id}:${c.date}` });
});
