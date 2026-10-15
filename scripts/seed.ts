import "dotenv/config";
import { signUp } from "@/server/services/accounts";
import { closeDb } from "@/server/db";

/**
 * Creates a demo church you can sign in to. Safe to run once per database;
 * it stops with a clear message if the demo account already exists.
 * Later phases extend this with members, giving and attendance data.
 */
const DEMO = {
  churchName: "Grace Assembly Lagos",
  name: "Pastor Tunde Adeyemi",
  email: "demo@buildmychurch.com",
  password: "Grace-Assembly-2026",
};

async function main() {
  try {
    const r = await signUp(DEMO);
    console.log(`Demo church created (${r.orgId}).\nSign in with ${DEMO.email} / ${DEMO.password}`);
  } catch (e) {
    if (e instanceof Error && /already has an account|already exists/.test(e.message))
      console.log(`The demo account already exists. Sign in with ${DEMO.email} / ${DEMO.password}`);
    else throw e;
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
