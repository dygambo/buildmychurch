import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { organisations, publicLinks } from "@/server/db/schema";
import { Logo } from "@/components/brand";
import { VisitorCard } from "./form";

export const metadata: Metadata = { title: "Visitor card", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [row] = await db
    .select({ name: organisations.name })
    .from(publicLinks)
    .innerJoin(organisations, eq(organisations.id, publicLinks.orgId))
    .where(and(eq(publicLinks.token, token), eq(publicLinks.kind, "visitor_form"), isNull(publicLinks.revokedAt)));
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="size-10" />
        {row ? (
          <>
            <h1 className="text-xl font-semibold">Welcome to {row.name}</h1>
            <p className="text-[13px] text-muted">
              We&apos;re so glad you came. Tell us a little about yourself so we can say hello properly.
            </p>
          </>
        ) : (
          <p className="text-muted">
            This visitor card link is no longer active. Please ask an usher for a paper card.
          </p>
        )}
      </div>
      {row && <VisitorCard token={token} church={row.name} />}
    </div>
  );
}
