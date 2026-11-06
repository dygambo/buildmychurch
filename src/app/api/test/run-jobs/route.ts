import { NextResponse } from "next/server";
import { runDueJobs } from "@/server/jobs/worker";

/**
 * Test-only endpoint: runs every queued job now. Returns 404 unless E2E_TEST_HOOKS=1.
 * It drains the whole queue (within a time limit), so a test's email isn't stuck behind a backlog
 * left by the seed or by other tests running at the same time.
 */
export async function POST() {
  if (process.env.E2E_TEST_HOOKS !== "1") return new NextResponse("Not found", { status: 404 });
  let total = 0;
  const until = Date.now() + 25_000;
  while (Date.now() < until) {
    const n = await runDueJobs("e2e", 50);
    total += n;
    if (n === 0) break;
  }
  return NextResponse.json({ ran: total });
}
