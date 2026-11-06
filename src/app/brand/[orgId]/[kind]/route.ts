import { brandImage } from "@/server/services/brand";

/** A church's logo or browser icon. Public, because logos appear in emails and on shared pages. */
export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string; kind: string }> }) {
  const { orgId, kind } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId) || (kind !== "logo" && kind !== "favicon")) return new Response("Not found", { status: 404 });
  const img = await brandImage(orgId, kind).catch(() => null);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      // the URL changes (?v=) whenever the image does, so it can be cached for a long time
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
