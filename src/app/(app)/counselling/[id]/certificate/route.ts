import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { brandForPdf } from "@/server/services/brand";
import { certificateData } from "@/server/services/counselling";
import { renderCertificate } from "@/server/pdf/certificate";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const { data, brand } = await withOrg(ctx.org.id, async (tx) => ({ data: await certificateData(tx, ctx, id), brand: await brandForPdf(tx, ctx.org.id) }));
    const buf = await renderCertificate({ ...data, ...brand });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${data.certificateNo.replace(/\//g, "-")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
