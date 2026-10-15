import "dotenv/config";
import postgres from "postgres";

/** Deletes ALL data in the development database (schema stays). Refuses to run in production. */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("db:reset is disabled in production");
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL must be set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    if (rows.length)
      await sql.unsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    console.log(`Emptied ${rows.length} tables. Run npm run db:seed for demo data.`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
