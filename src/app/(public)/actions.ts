"use server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg } from "@/server/db";
import { branches, organisations, publicLinks } from "@/server/db/schema";
import { zodFieldErrors, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/request";
import { readCheckinLink, selfCheckIn } from "@/server/services/attendance";
import { submitVisitorCard, visitorSchema } from "@/server/services/followup";

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error("[public]", e);
    return { ok: false, error: "Something went wrong on our side. Please try again, or ask an usher." };
  }
}

export async function selfCheckInAction(input: { token: string; phone: string }) {
  return guard(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`selfcheckin:${ip}`, 20, 600)))
      throw new AppError("Too many tries from this phone. Please ask an usher to check you in.");
    const link = await db.transaction((tx) => readCheckinLink(tx, String(input.token)));
    if (!link) throw new AppError("This check-in code has expired. Ask an usher for today's code.");
    return withOrg(link.orgId, (tx) => selfCheckIn(tx, link.targetId!, String(input.phone ?? "")));
  });
}

export async function visitorCardAction(input: { token: string; values: Record<string, unknown> }) {
  return guard(async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`visitor:${ip}`, 10, 3600)))
      throw new AppError("Too many cards sent from this phone. Please speak to an usher.");
    const parsed = visitorSchema.safeParse(input.values);
    if (!parsed.success) throw new AppError("Please check the highlighted fields.", zodFieldErrors(parsed.error));
    const [link] = await db
      .select()
      .from(publicLinks)
      .where(
        and(
          eq(publicLinks.token, String(input.token)),
          eq(publicLinks.kind, "visitor_form"),
          isNull(publicLinks.revokedAt),
        ),
      );
    if (!link) throw new AppError("This visitor card link is no longer active. Please ask an usher for a paper card.");
    const [org] = await db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, link.orgId));
    return withOrg(link.orgId, async (tx) => {
      const [hq] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.level, "hq"));
      return submitVisitorCard(tx, org!, link.targetId ?? hq!.id, input.values as z.input<typeof visitorSchema>);
    });
  });
}
