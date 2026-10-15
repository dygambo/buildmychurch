import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { organisations } from "@/server/db/schema";
import { givingPageData } from "@/server/services/giving";
import { paymentsProvider } from "@/server/providers/payments";
import { Logo } from "@/components/brand";
import { GiveForm } from "./form";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const [org] = await db
    .select({ id: organisations.id, name: organisations.name, status: organisations.status })
    .from(organisations)
    .where(eq(organisations.slug, slug));
  if (!org || org.status === "suspended") return null;
  let mode: "fake" | "paystack" | "off" = "off";
  try {
    mode = paymentsProvider();
  } catch {}
  const data = await withOrg(org.id, (tx) => givingPageData(tx, org.id));
  const ready = mode === "fake" || (mode === "paystack" && !!data.settings.subaccountCode);
  return { org, mode, ready, data };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [org] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.slug, slug));
  return { title: org ? `Give to ${org.name}` : "Give", robots: { index: false } };
}

export default async function GivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ project?: string; fund?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = await load(slug);
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="size-10" />
        {page ? (
          <>
            <h1 className="text-xl font-semibold">Give to {page.org.name}</h1>
            <p className="text-[13px] text-muted">Tithes, offerings and project gifts. You&apos;ll get a receipt by email.</p>
          </>
        ) : (
          <p className="text-muted">This giving page isn&apos;t available. Check the link with the church office.</p>
        )}
      </div>
      {page &&
        (page.ready ? (
          <GiveForm
            slug={slug}
            church={page.org.name}
            testMode={page.mode === "fake"}
            funds={page.data.funds.map((f) => ({ id: f.id, name: f.name, description: f.description }))}
            projects={page.data.campaigns.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              goalKobo: c.goalKobo,
              raised: c.raised,
            }))}
            branches={page.data.branches.map((b) => ({ id: b.id, name: b.name, hq: b.level === "hq" }))}
            preset={{ project: sp.project, fund: sp.fund }}
          />
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-5 text-center text-[13px] text-muted">
            Online giving for {page.org.name} isn&apos;t switched on yet. You can still give at church, by cash, POS or
            bank transfer.
          </p>
        ))}
    </div>
  );
}
