import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { previewPdf, versionPdf } from "@/server/services/schedules";

/** The current (or a chosen) version's PDF; ?preview=1 renders the saved draft for coordinators. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to download this schedule.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  try {
    let f: { name: string; bytes: Buffer };
    if (sp.get("preview") === "1") {
      if (!(await rateLimit(`schedule-preview:${ctx.user.id}`, 60, 600))) return new Response("Too many previews. Wait a minute.", { status: 429 });
      f = await withOrg(ctx.org.id, (tx) => previewPdf(tx, ctx, id));
    } else {
      const v = Number(sp.get("v")) || undefined;
      f = await withOrg(ctx.org.id, (tx) => versionPdf(tx, ctx, id, v));
    }
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "pdf_pending" ? 409 : e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
