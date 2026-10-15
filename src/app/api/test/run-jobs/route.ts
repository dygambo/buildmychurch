import { NextResponse } from "next/server";
import { runDueJobs } from "@/server/jobs/worker";

/** Test-only endpoint: runs queued jobs immediately. Returns 404 unless E2E_TEST_HOOKS=1. */
export async function POST() {
  if (process.env.E2E_TEST_HOOKS !== "1") return new NextResponse("Not found", { status: 404 });
  let total = 0;
  for (let i = 0; i < 5; i++) total += await runDueJobs("e2e");
  return NextResponse.json({ ran: total });
}
