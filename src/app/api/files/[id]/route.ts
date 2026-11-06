import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { getObject } from "@/server/providers/storage";
import { fileForDownload } from "@/server/services/files";

/** Streams a file to someone allowed to see the record it belongs to. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to open this file.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const f = await withOrg(ctx.org.id, (tx) => fileForDownload(tx, ctx, id));
    const bytes = await getObject(f.storageKey);
    const inline = f.mime === "application/pdf" || f.mime.startsWith("image/");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": f.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // a PDF or image opened from here can't run scripts against the app
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 404 });
    console.error("[download]", e);
    return new Response("We couldn't open that file. Try again in a moment.", { status: 500 });
  }
}
