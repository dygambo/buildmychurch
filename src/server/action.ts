import { z } from "zod";
import { withOrg, type Tx } from "./db";
import { getCtx, type Ctx } from "./auth/context";
import type { Permission } from "./auth/permissions";
import { AppError } from "./errors";

export type ActionResult<T = undefined> =
  { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function zodFieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join(".") || "_";
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

/**
 * Wraps a server action: requires a signed-in user, checks the permission, validates input,
 * runs inside a church-scoped transaction (row-level security), and turns errors into
 * messages the user can act on.
 */
export function orgAction<S extends z.ZodType, O>(
  opts: { perm?: Permission; schema: S },
  fn: (input: z.infer<S>, ctx: Ctx, tx: Tx) => Promise<O | { data: O; message?: string }>,
) {
  return async (input: z.input<S>): Promise<ActionResult<O>> => {
    const ctx = await getCtx();
    if (!ctx) return { ok: false, error: "Your session has ended. Sign in again to continue." };
    if (opts.perm && !ctx.can(opts.perm))
      return { ok: false, error: "Your role doesn't allow this. Ask a Super Admin if you need access." };
    const parsed = opts.schema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
    try {
      const res = await withOrg(ctx.org.id, (tx) => fn(parsed.data, ctx, tx));
      if (
        res &&
        typeof res === "object" &&
        "data" in (res as object) &&
        Object.keys(res as object).every((k) => k === "data" || k === "message")
      )
        return { ok: true, ...(res as { data: O; message?: string }) };
      return { ok: true, data: res as O };
    } catch (e) {
      if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
      console.error("[action]", e);
      return { ok: false, error: "Something went wrong on our side, and nothing was saved. Try again in a moment." };
    }
  };
}
