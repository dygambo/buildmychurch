import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Ctx } from "../auth/context";
import { withOrg } from "../db";
import { childCheckins, expenses, followups, givingBatches } from "../db/schema";

type Badges = Record<string, { count: number; tone?: "accent" | "bad" }>;

/** Counts shown next to sidebar items: things waiting on this user. Kept to cheap indexed queries. */
export async function navBadges(ctx: Ctx): Promise<Badges> {
  return withOrg(ctx.org.id, async (tx) => {
    const out: Badges = {};
    if (ctx.can("followup.manage")) {
      const [mine] = await tx
        .select({ n: count(), overdue: sql<number>`count(*) filter (where ${followups.dueAt} < now())::int` })
        .from(followups)
        .where(and(eq(followups.assignedTo, ctx.user.id), inArray(followups.stage, ["new", "contacted"])));
      if (mine && Number(mine.n) > 0)
        out["/follow-up"] = { count: Number(mine.n), tone: Number(mine.overdue) > 0 ? "bad" : "accent" };
    }
    if (ctx.can("children.checkin")) {
      const [here] = await tx.select({ n: count() }).from(childCheckins).where(isNull(childCheckins.checkedOutAt));
      if (here && Number(here.n) > 0) out["/children"] = { count: Number(here.n) };
    }
    if (ctx.can("giving.verify")) {
      const [waiting] = await tx
        .select({ n: count() })
        .from(givingBatches)
        .where(
          and(
            eq(givingBatches.status, "submitted"),
            ne(givingBatches.countedBy, ctx.user.id),
            ctx.branchIds.length ? inArray(givingBatches.branchId, ctx.branchIds) : undefined,
          ),
        );
      if (waiting && Number(waiting.n) > 0) out["/giving"] = { count: Number(waiting.n), tone: "accent" };
    }
    if (ctx.can("finance.approve")) {
      const [waiting] = await tx
        .select({ n: count() })
        .from(expenses)
        .where(
          and(
            eq(expenses.status, "submitted"),
            ne(expenses.requestedBy, ctx.user.id),
            ctx.branchIds.length ? inArray(expenses.branchId, ctx.branchIds) : undefined,
          ),
        );
      if (waiting && Number(waiting.n) > 0) out["/expenses"] = { count: Number(waiting.n), tone: "accent" };
    }
    if (ctx.can("memo.approve") || ctx.can("memo.disburse")) {
      const { memoCounts } = await import("./memos");
      const c = await memoCounts(tx, ctx);
      if (c.action + c.pay > 0) out["/memos"] = { count: c.action + c.pay, tone: "accent" };
    }
    if (ctx.can("counselling.manage") || ctx.can("counselling.oversee")) {
      const { counsellingCounts } = await import("./counselling");
      const c = await counsellingCounts(tx, ctx);
      if (c.enquiries + c.toRecord > 0) out["/counselling"] = { count: c.enquiries + c.toRecord, tone: "accent" };
    }
    if (ctx.can("care.manage")) {
      const { careSummary } = await import("./care");
      const c = await careSummary(tx, ctx);
      if (c.newPrayer + c.dueCases > 0) out["/care"] = { count: c.newPrayer + c.dueCases, tone: c.dueCases > 0 ? "bad" : "accent" };
    }
    return out;
  });
}
