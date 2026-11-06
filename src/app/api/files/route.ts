import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { MAX_FILE_BYTES, isFileEntity, uploadFile } from "@/server/services/files";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Attach a file to a record. Multipart form: entityType, entityId, file. */
export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return json({ error: "Your session has ended. Sign in again to continue." }, 401);
  if (!(await rateLimit(`upload:${ctx.user.id}`, 120, 3600)))
    return json({ error: "Too many uploads in the last hour. Try again later." }, 429);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FILE_BYTES + 64 * 1024) return json({ error: "Files can be up to 10 MB." }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "That upload was incomplete. Try again." }, 400);
  }
  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "");
  const file = form.get("file");
  if (!isFileEntity(entityType) || !/^[0-9a-f-]{36}$/i.test(entityId) || !(file instanceof File))
    return json({ error: "Choose a file to attach." }, 400);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const f = await withOrg(ctx.org.id, (tx) => uploadFile(tx, ctx, { entityType, entityId, name: file.name, bytes }));
    return json({ file: f }, 201);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 400);
    console.error("[upload]", e);
    return json({ error: "Something went wrong on our side, and the file wasn't saved. Try again in a moment." }, 500);
  }
}
