import { eq } from "drizzle-orm";
import { withOrg } from "@/server/db";
import { organisations } from "@/server/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { renderStatement } from "@/server/pdf/statement";
import { brandForPdf } from "@/server/services/brand";
import { portalChurch, portalGiving, portalMember } from "@/server/services/portal";
import { todayISO } from "@/lib/format";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const church = await portalChurch(slug);
  if (!church) return new Response("Not found", { status: 404 });
  const me = await portalMember(church);
  if (!me) return new Response("Sign in first.", { status: 401 });
  if (!(await rateLimit(`portal-statement:${me.id}`, 20, 3600))) return new Response("Too many downloads. Try again later.", { status: 429 });
  const thisYear = Number(todayISO().slice(0, 4));
  const y = Number(new URL(req.url).searchParams.get("year"));
  const year = y >= 2000 && y <= thisYear ? y : thisYear;
  const g = await portalGiving(church, me, year);
  const { o, brand } = await withOrg(church.id, async (tx) => ({
    o: (await tx.select({ name: organisations.name, address: organisations.address, phone: organisations.phone, email: organisations.email }).from(organisations).where(eq(organisations.id, church.id)))[0],
    brand: await brandForPdf(tx, church.id),
  }));
  const buf = await renderStatement({ o: o!, name: [me.title, me.firstName, me.lastName].filter(Boolean).join(" "), memberNo: me.memberNo, g, ...brand });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${year}-giving-statement.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
