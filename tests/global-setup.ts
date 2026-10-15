import "dotenv/config";
import { runMigrations } from "../scripts/migrate";

export default async function setup() {
  const admin =
    process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://bmc_owner:bmc_owner@localhost:5432/buildmychurch_test";
  await runMigrations(admin, "bmc_app");
}
