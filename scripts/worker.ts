import "dotenv/config";
import { closeDb } from "@/server/db";
import { workerLoop } from "@/server/jobs/worker";
import { runScheduler } from "@/server/jobs/scheduler";

const ac = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());

console.log("[worker] started");
Promise.all([workerLoop(ac.signal), runScheduler(ac.signal)])
  .then(() => closeDb())
  .then(() => console.log("[worker] stopped"));
