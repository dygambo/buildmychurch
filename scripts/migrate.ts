import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies migrations with the owner connection, then (re)grants the app role exactly what it needs.
 * The app role can read and write business tables but can never UPDATE or DELETE audit records.
 */
export async function runMigrations(adminUrl: string, appRole: string) {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    const role = sql(appRole);
    await sql`GRANT USAGE ON SCHEMA public TO ${role}`;
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`;
    await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`;
    await sql`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM ${role}`;
    await sql`REVOKE ALL ON SCHEMA drizzle FROM ${role}`.catch(() => {});
  } finally {
    await sql.end();
  }
}

function roleFromUrl(url: string) {
  return decodeURIComponent(new URL(url).username);
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL must both be set");
  runMigrations(adminUrl, process.env.APP_DB_ROLE ?? roleFromUrl(appUrl))
    .then(() => console.log("Migrations applied."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
