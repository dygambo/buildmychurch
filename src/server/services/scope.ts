import { inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Actor } from "../auth/context";
import { forbidden } from "../errors";

/**
 * Branch scoping. Row-level security keeps churches apart; this keeps branch staff to their own branches.
 * A user with no branch list sees every branch.
 */
export function branchScope(ctx: Pick<Actor, "branchIds">, col: PgColumn): SQL | undefined {
  return ctx.branchIds.length ? inArray(col, ctx.branchIds) : undefined;
}

export function assertBranch(ctx: Pick<Actor, "branchIds">, branchId: string) {
  if (ctx.branchIds.length && !ctx.branchIds.includes(branchId)) throw forbidden("work with records in that branch");
}
