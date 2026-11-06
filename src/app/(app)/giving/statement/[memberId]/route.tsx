import { eq } from "drizzle-orm";
import { getCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { members, organisations } from "@/server/db/schema";
import { memberGiving } from "@/server/services/giving";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { todayISO } from "@/lib/format";
import { renderStatement } from "@/server/pdf/statement";
import { brandForPdf } from "@/server/services/brand";

export async function GET(req: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in to download statements.", { status: 401 });
  if (!ctx.can("giving.read_named")) return new Response("Your role doesn't allow seeing who gave what.", { status: 403 });
  if (!/^[0-9a-f-]{36}$/.test(memberId)) return new Response("Not found", { status: 404 });
  if (!(await rateLimit(`statement:${ctx.user.id}`, 60, 3600))) return new Response("Too many downloads. Try again later.", { status: 429 });
  const year = Number(new URL(req.url).searchParams.get("year")) || Number(todayISO().slice(0, 4));
  const data = await withOrg(ctx.org.id, async (tx) => {
    const [m] = await tx
      .select({ title: members.title, firstName: members.firstName, lastName: members.lastName, memberNo: members.memberNo })
      .from(members)
      .where(eq(members.id, memberId));
    if (!m) return null;
    const [o] = await tx
      .select({ name: organisations.name, address: organisations.address, phone: organisations.phone, email: organisations.email })
      .from(organisations)
      .where(eq(organisations.id, ctx.org.id));
    const g = await memberGiving(tx, ctx, memberId, year);
    await audit(tx, ctx, {
      action: "giving.statement",
      summary: `Downloaded ${m.firstName} ${m.lastName}'s ${year} giving statement`,
      entityType: "member",
      entityId: memberId,
    });
    return { m, o: o!, g, brand: await brandForPdf(tx, ctx.org.id) };
  });
  if (!data) return new Response("Not found", { status: 404 });
  const { m, o, g, brand } = data;
  const name = [m.title, m.firstName, m.lastName].filter(Boolean).join(" ");
  const buf = await renderStatement({ o, name, memberNo: m.memberNo, g, ...brand });
  const file = `${year}-giving-statement-${m.firstName}-${m.lastName}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
