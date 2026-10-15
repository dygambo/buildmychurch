import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const g = globalThis as unknown as { __bmcSql?: postgres.Sql; __bmcDb?: Db };

function create(): Db {
  const e = env();
  const client =
    g.__bmcSql ??
    postgres(e.DATABASE_URL, { max: e.DB_POOL_MAX, prepare: e.DB_PREPARE === "true", onnotice: () => {} });
  g.__bmcSql = client;
  return drizzle(client, { schema });
}

/** Lazily-created Drizzle client (connects on first use). */
export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    g.__bmcDb ??= create();
    return Reflect.get(g.__bmcDb, prop, g.__bmcDb);
  },
});

/**
 * Run work inside a transaction scoped to one church. Postgres row-level security
 * policies read `app.org_id`, so queries can only ever see this organisation's rows.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  if (g.__bmcSql) await g.__bmcSql.end({ timeout: 5 });
  g.__bmcSql = undefined;
  g.__bmcDb = undefined;
}

export { schema };
