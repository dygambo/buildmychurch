import "dotenv/config";
import { tmpdir } from "node:os";

// Tests always run against the separate test database, never the development one.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://bmc_app:bmc_app@localhost:5432/buildmychurch_test";
process.env.DATABASE_ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://bmc_owner:bmc_owner@localhost:5432/buildmychurch_test";
process.env.EMAIL_PROVIDER = "log";
process.env.SMS_PROVIDER = "log";
process.env.STORAGE_DIR = `${tmpdir()}/bmc-test-storage`;
