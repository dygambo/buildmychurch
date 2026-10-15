import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { devMailbox, jobs } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { registerJob } from "@/server/jobs/registry";
import { runDueJobs } from "@/server/jobs/worker";
import { resetDb } from "../helpers";

beforeEach(resetDb);

describe("job queue", () => {
  it("sends a queued email exactly once, even if enqueued twice with the same key", async () => {
    await enqueue(db, "email.send", { to: "a@example.com", subject: "Hello", html: "<p>Hi</p>" }, { dedupeKey: "k1" });
    await enqueue(db, "email.send", { to: "a@example.com", subject: "Hello", html: "<p>Hi</p>" }, { dedupeKey: "k1" });
    expect(await runDueJobs("t")).toBe(1);
    expect(await runDueJobs("t")).toBe(0);
    const mail = await db.select().from(devMailbox);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe("Hello");
  });
  it("retries transient failures with backoff and stops at the limit", async () => {
    let calls = 0;
    registerJob("test.flaky", async () => {
      calls++;
      throw new Error("provider timeout");
    });
    const id = (await enqueue(db, "test.flaky", {}, { maxAttempts: 2 }))!;
    await runDueJobs("t");
    let [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j!.status).toBe("queued");
    expect(j!.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, id));
    await runDueJobs("t");
    [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j).toMatchObject({ status: "failed", attempts: 2, lastError: "provider timeout" });
    expect(calls).toBe(2);
  });
  it("fails permanently on a bad address without retrying", async () => {
    const id = (await enqueue(db, "email.send", { to: "not-an-email", subject: "x", html: "x" }))!;
    await runDueJobs("t");
    const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j!.status).toBe("failed");
    expect(j!.attempts).toBe(1);
  });
});
