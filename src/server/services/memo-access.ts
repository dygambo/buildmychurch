import { and, eq, lte } from "drizzle-orm";
import type { Tx } from "../db";
import { memoSteps, memos } from "../db/schema";
import type { Actor } from "../auth/context";

/**
 * Who may open a memo:
 * - whoever raised it;
 * - the people on its approval path, once it has reached their step (so a department's memo stays
 *   within the department until it's sent up);
 * - finance staff who disburse, once it's approved;
 * - for memos that aren't confidential, leaders allowed to open confidential memos may also open them.
 * Confidential memos are limited to the first three groups and leaders with "open confidential memos".
 */
export async function memoVisibleTo(tx: Tx, ctx: Actor, memoId: string) {
  const [m] = await tx.select().from(memos).where(eq(memos.id, memoId));
  if (!m) return null;
  if (ctx.branchIds.length && !ctx.branchIds.includes(m.branchId)) return null;
  if (m.initiatorId === ctx.user.id) return m;
  if (m.status === "draft") return null;
  if (ctx.can("memo.view_confidential")) return m;
  if (m.status === "approved" && m.amountKobo && ctx.can("memo.disburse")) return m;
  const reached = await tx
    .select({ roleKey: memoSteps.roleKey, userId: memoSteps.userId, actedBy: memoSteps.actedBy })
    .from(memoSteps)
    .where(and(eq(memoSteps.memoId, memoId), m.currentStep ? lte(memoSteps.position, m.currentStep) : undefined));
  const onPath = reached.some(
    (s) => s.actedBy === ctx.user.id || s.userId === ctx.user.id || (!s.userId && s.roleKey === ctx.membership.roleKey && ctx.can("memo.approve")),
  );
  return onPath ? m : null;
}
