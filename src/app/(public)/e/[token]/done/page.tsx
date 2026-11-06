import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Card, CardBody } from "@/components/ui/card";
import { withOrg } from "@/server/db";
import { eventRegistrations } from "@/server/db/schema";
import { getIntent, settlePayment } from "@/server/services/payments";

export const metadata: Metadata = { title: "Registration", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Where checkout sends people back. Asks the payment provider what happened, then shows the ticket. */
export default async function Done({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ref = sp.reference ?? sp.trxref;
  const intent = ref ? await getIntent(ref) : null;
  if (!intent || intent.purpose !== "event")
    return (
      <Card className="w-full max-w-md">
        <CardBody className="text-[13px] text-muted">We couldn&apos;t find that payment.</CardBody>
      </Card>
    );
  const status = await settlePayment(intent.reference);
  if (status === "succeeded") {
    const [r] = await withOrg(intent.orgId, (tx) => tx.select({ code: eventRegistrations.code }).from(eventRegistrations).where(eq(eventRegistrations.id, intent.targetId)));
    redirect(`/e/${token}/t/${r!.code}`);
  }
  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-2 text-center text-[14px]">
        <h1 className="text-lg font-semibold">{status === "pending" ? "Waiting for the bank" : "Payment didn't go through"}</h1>
        <p className="text-muted">
          {status === "pending"
            ? "We'll email your ticket as soon as the bank confirms. You can close this page."
            : "No money was taken. Go back to the event page to try again."}
        </p>
        <a href={`/e/${token}`} className="text-accent">
          Back to the event
        </a>
      </CardBody>
    </Card>
  );
}
