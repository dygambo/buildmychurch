import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { organisations, publicLinks } from "@/server/db/schema";
import { readCheckinLink, serviceForSelfCheckin } from "@/server/services/attendance";
import { Logo } from "@/components/brand";
import { SelfCheckin } from "./form";

export const metadata: Metadata = { title: "Check in", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await db.transaction((tx) => readCheckinLink(tx, token));
  const data = link
    ? await withOrg(link.orgId, async (tx) => ({
        service: await serviceForSelfCheckin(tx, link.targetId!),
        org: (
          await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, link.orgId))
        )[0]!,
        visitor: (
          await tx
            .select({ token: publicLinks.token })
            .from(publicLinks)
            .where(
              and(
                eq(publicLinks.orgId, link.orgId),
                eq(publicLinks.kind, "visitor_form"),
                isNull(publicLinks.revokedAt),
              ),
            )
        )[0]?.token,
      }))
    : null;
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
      <Logo className="size-10" />
      {!data?.service ? (
        <p className="text-muted">This check-in code isn&apos;t valid any more. Please ask an usher.</p>
      ) : (
        <>
          <div>
            <p className="text-[13px] text-muted">{data.org.name}</p>
            <h1 className="mt-1 text-xl font-semibold">{data.service.name}</h1>
          </div>
          {data.service.state === "open" ? (
            <SelfCheckin token={token} visitorHref={data.visitor ? `/welcome/${data.visitor}` : null} />
          ) : (
            <p className="text-muted">
              {data.service.state === "early"
                ? "Check-in opens two hours before the service starts."
                : "Check-in for this service has closed."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
