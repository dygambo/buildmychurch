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

// Every 15 minutes: re-check online payments still waiting for confirmation (one job per slot, across all churches).
every(15, async (now) => {
  const slot = Math.floor(now.getTime() / (15 * 60_000));
  await enqueue(db, "payments.reconcile", {}, { dedupeKey: `payments-reconcile:${slot}`, maxAttempts: 1 });
});

// 1st of the month, 6am: branch remittances for the month just ended (churches with one branch get nothing).
every(60, async (now) => {
  const c = lagosClock(now);
  if (c.date.slice(8) !== "01" || c.hour !== 6) return;
  const [y, m] = c.date.split("-").map(Number) as [number, number];
  const period = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const o of orgs)
    await enqueue(db, "finance.remittances", { period }, { orgId: o.id, dedupeKey: `remittances:${o.id}:${period}` });
});

// 7am every day: automatic messages (birthdays, anniversaries, welcomes, pledge reminders) for each church.
every(60, async (now) => {
  const c = lagosClock(now);
  if (c.hour !== 7) return;
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const o of orgs)
    await enqueue(db, "messaging.automations", { date: c.date }, { orgId: o.id, dedupeKey: `automations:${o.id}:${c.date}` });
});

// Every 15 minutes: put back messages a crashed worker left half-sent.
every(15, async (now) => {
  const slot = Math.floor(now.getTime() / (15 * 60_000));
  await enqueue(db, "messages.requeue", {}, { dedupeKey: `messages-requeue:${slot}`, maxAttempts: 1 });
});

// 1am every day: services that have happened are marked completed.
every(60, async (now) => {
  const c = lagosClock(now);
  if (c.hour !== 1) return;
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const o of orgs) await enqueue(db, "schedule.complete", {}, { orgId: o.id, dedupeKey: `schedule-complete:${o.id}:${c.date}` });
});

// 5pm every day: remind volunteers serving tomorrow.
every(60, async (now) => {
  const c = lagosClock(now);
  if (c.hour !== 17) return;
  const tomorrow = new Date(new Date(`${c.date}T12:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const o of orgs) {
    await enqueue(db, "rota.remind", { date: tomorrow }, { orgId: o.id, dedupeKey: `rota-remind:${o.id}:${tomorrow}` });
    await enqueue(db, "counselling.remind", { date: tomorrow }, { orgId: o.id, dedupeKey: `counselling-remind:${o.id}:${tomorrow}` });
  }
});
