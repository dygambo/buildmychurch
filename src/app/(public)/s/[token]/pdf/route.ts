import { headers } from "next/headers";
import { rateLimit } from "@/server/rate-limit";
import { publicSchedulePdf } from "@/server/services/schedules";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await rateLimit(`share-pdf:${ip}`, 60, 600))) return new Response("Too many downloads. Try again shortly.", { status: 429 });
  try {
    const f = await publicSchedulePdf(token);
    if (!f) return new Response("This link has expired or been withdrawn.", { status: 404 });
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("The PDF isn't ready yet. Try again in a moment.", { status: 409 });
  }
}
