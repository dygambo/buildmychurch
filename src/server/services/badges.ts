import type { Ctx } from "../auth/context";

/** Counts shown next to sidebar items (things waiting on this user). Modules add to this as they're built. */
export async function navBadges(_ctx: Ctx): Promise<Record<string, { count: number; tone?: "accent" | "bad" }>> {
  return {};
}
