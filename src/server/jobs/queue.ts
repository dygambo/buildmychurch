import { and, eq, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { jobs } from "../db/schema";

export type EnqueueOptions = { orgId?: string | null; runAt?: Date; dedupeKey?: string; maxAttempts?: number };

/**
 * Adds a job. Pass the current transaction so the job is only queued if the surrounding change commits
 * (the "transactional outbox" pattern). A dedupe key makes enqueueing idempotent.
 */
export async function enqueue(tx: DbOrTx, type: string, payload: Record<string, unknown>, o: EnqueueOptions = {}) {
  const rows = await tx
    .insert(jobs)
    .values({
      type,
      payload,
      orgId: o.orgId ?? null,
      runAt: o.runAt ?? new Date(),
      dedupeKey: o.dedupeKey ?? null,
      maxAttempts: o.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

export type JobRow = typeof jobs.$inferSelect;

/** Claims up to `limit` due jobs. SKIP LOCKED lets several workers run side by side safely. */
export async function claimJobs(workerId: string, limit = 10): Promise<JobRow[]> {
  const rows = await db.execute<JobRow & { run_at: Date }>(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
    where id in (
      select id from jobs where status = 'queued' and run_at <= now()
      order by run_at limit ${limit} for update skip locked
    )
    returning id, org_id as "orgId", type, payload, attempts, max_attempts as "maxAttempts"`);
  return rows as unknown as JobRow[];
}

export async function completeJob(id: string) {
  await db.update(jobs).set({ status: "done", doneAt: new Date(), lastError: null }).where(eq(jobs.id, id));
}

/** Retries with exponential backoff (30s, 1m, 2m, 4m…) unless the error is permanent or attempts are used up. */
export async function failJob(job: Pick<JobRow, "id" | "attempts" | "maxAttempts">, error: string, permanent = false) {
  const final = permanent || job.attempts >= job.maxAttempts;
  const delay = Math.min(30_000 * 2 ** (job.attempts - 1), 60 * 60_000);
  await db
    .update(jobs)
    .set(
      final
        ? { status: "failed", lastError: error.slice(0, 2000) }
        : {
            status: "queued",
            lastError: error.slice(0, 2000),
            runAt: new Date(Date.now() + delay),
            lockedAt: null,
            lockedBy: null,
          },
    )
    .where(eq(jobs.id, job.id));
  return final;
}

/** Puts jobs whose worker died mid-run back in the queue. */
export async function recoverStuckJobs(olderThanMinutes = 10) {
  await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - olderThanMinutes * 60_000))));
}
