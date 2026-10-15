import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Ctx } from "../auth/context";
import { withOrg } from "../db";
import { childCheckins, followups } from "../db/schema";

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
    return out;
  });
}
