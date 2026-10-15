import "dotenv/config";
import postgres from "postgres";

/** Clears rate-limit counters so repeated local runs don't trip the sign-up and sign-in limits. */
export default async function globalSetup() {
  const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
  await sql`delete from rate_limits`;
  await sql.end();
}
