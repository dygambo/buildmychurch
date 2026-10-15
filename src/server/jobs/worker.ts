import { hostname } from "node:os";
import { PermanentSendError } from "../providers/email";
import { claimJobs, completeJob, failJob, recoverStuckJobs } from "./queue";
import { getHandler } from "./registry";
import "./handlers";

/** Processes due jobs once. Returns how many ran. Used by the worker loop and by tests. */
export async function runDueJobs(workerId = `${hostname()}:${process.pid}`, limit = 10): Promise<number> {
  const batch = await claimJobs(workerId, limit);
  for (const job of batch) {
    const handler = getHandler(job.type);
    if (!handler) {
      await failJob(job, `No handler registered for job type "${job.type}"`, true);
      continue;
    }
    try {
      await handler(job);
      await completeJob(job.id);
    } catch (e) {
      const permanent = e instanceof PermanentSendError || (e as { permanent?: boolean }).permanent === true;
      await failJob(job, (e as Error).message ?? String(e), permanent);
    }
  }
  return batch.length;
}

export async function workerLoop(signal: AbortSignal) {
  let lastRecover = 0;
  while (!signal.aborted) {
    if (Date.now() - lastRecover > 60_000) {
      await recoverStuckJobs().catch(() => {});
      lastRecover = Date.now();
    }
    const n = await runDueJobs().catch((e) => {
      console.error("[worker]", e);
      return 0;
    });
    if (n === 0) await new Promise((r) => setTimeout(r, 1000));
  }
}
