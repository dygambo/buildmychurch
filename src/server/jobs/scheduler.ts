/**
 * Recurring work (birthday greetings, reminders, reconciliation). Each tick enqueues jobs with a
 * dedupe key per period, so running several schedulers at once never sends anything twice.
 */
type Recurring = { everyMinutes: number; run: (now: Date) => Promise<void> };
const recurring: Recurring[] = [];

export function every(minutes: number, run: (now: Date) => Promise<void>) {
  recurring.push({ everyMinutes: minutes, run });
}

export async function schedulerTick(now = new Date()) {
  for (const r of recurring) {
    const slot = Math.floor(now.getTime() / 60000);
    if (slot % r.everyMinutes === 0) await r.run(now).catch((e) => console.error("[scheduler]", e));
  }
}

export async function runScheduler(signal: AbortSignal) {
  await import("./schedules");
  while (!signal.aborted) {
    await schedulerTick();
    const msToNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    await new Promise((r) => setTimeout(r, msToNextMinute));
  }
}
