import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { db, withOrg } from "@/server/db";
import { givingFunds, givingTransactions, organisations } from "@/server/db/schema";
import { getIntent, settlePayment } from "@/server/services/payments";
import { Logo } from "@/components/brand";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, naira } from "@/lib/format";

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const reference = String(sp.reference ?? sp.trxref ?? "");
  const [org] = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.slug, slug));
  const intent = reference ? await getIntent(reference) : null;
  if (!org || !intent || intent.orgId !== org.id) {
    return <Shell>{<p className="text-center text-muted">We couldn&apos;t find that payment.</p>}</Shell>;
  }
  let status: string = intent.status;
  if (status === "pending") status = await settlePayment(reference).catch(() => "pending");
  const gift = await withOrg(org.id, async (tx) => {
    const [g] = await tx
      .select({ t: givingTransactions, fund: givingFunds.name })
      .from(givingTransactions)
      .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
      .where(eq(givingTransactions.id, intent.targetId));
    return g ?? null;
  });
  return (
    <Shell>
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-8 text-center" role="status">
          {status === "succeeded" ? (
            <>
              <CheckCircle2 className="size-12 text-good" />
              <p className="text-lg font-semibold">Thank you! {gift ? naira(gift.t.amountKobo) : ""} received</p>
              {gift && (
                <dl className="grid w-full max-w-xs grid-cols-2 gap-x-3 gap-y-1.5 text-left text-[13px]">
                  <dt className="text-muted">Given to</dt>
                  <dd className="font-medium">{gift.fund}</dd>
                  <dt className="text-muted">Date</dt>
                  <dd className="font-medium">{formatDate(String(gift.t.givenOn))}</dd>
                  <dt className="text-muted">Receipt</dt>
                  <dd className="font-mono font-medium" data-testid="receipt-no">
                    {gift.t.receiptNo ?? "On its way"}
                  </dd>
                </dl>
              )}
              <p className="text-[13px] text-muted">Your receipt is on its way to {intent.email}.</p>
            </>
          ) : status === "pending" ? (
            <>
              <Clock className="size-12 text-warn" />
              <p className="text-lg font-semibold">Waiting for your bank</p>
              <p className="text-[13px] text-muted">
                Bank transfers and USSD can take a few minutes. We&apos;ll email your receipt as soon as the payment
                comes through. You don&apos;t need to pay again.
              </p>
              <Button asChild>
                <Link href={`/give/${slug}/thanks?reference=${encodeURIComponent(reference)}`}>Check again</Link>
              </Button>
            </>
          ) : (
            <>
              <XCircle className="size-12 text-bad" />
              <p className="text-lg font-semibold">The payment didn&apos;t go through</p>
              <p className="text-[13px] text-muted">
                {intent.failureReason ?? "No money was taken."} You can try again with another card or method.
              </p>
              <Button asChild variant="primary">
                <Link href={`/give/${slug}`}>Try again</Link>
              </Button>
            </>
          )}
        </CardBody>
      </Card>
      <p className="text-center text-xs text-faint">{org.name}</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="flex justify-center">
        <Logo className="size-10" />
      </div>
      {children}
    </div>
  );
}
