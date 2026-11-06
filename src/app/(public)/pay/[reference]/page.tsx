import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { FlaskConical } from "lucide-react";
import { db } from "@/server/db";
import { organisations } from "@/server/db/schema";
import { getIntent } from "@/server/services/payments";
import { paymentsProvider } from "@/server/providers/payments";
import { Card, CardBody, Note } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { naira } from "@/lib/format";
import { fakePayAction } from "../../actions";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Practice checkout used when PAYMENTS_PROVIDER=fake. Never reachable on a live site. */
export default async function FakeCheckout({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  let fake = false;
  try {
    fake = paymentsProvider() === "fake";
  } catch {}
  const intent = fake ? await getIntent(decodeURIComponent(reference)) : null;
  if (!intent || intent.provider !== "fake")
    return <p className="text-muted">This checkout link isn&apos;t valid.</p>;
  const [org] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, intent.orgId));
  const pay = fakePayAction.bind(null, intent.reference, "pay");
  const decline = fakePayAction.bind(null, intent.reference, "decline");
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-warn">
            <FlaskConical className="size-4" /> Practice checkout
          </div>
          <div>
            <p className="text-[13px] text-muted">{intent.purpose === "sms_topup" ? "SMS units for" : "Pay"} {org?.name}</p>
            <p className="tabular text-3xl font-semibold">{naira(intent.amountKobo)}</p>
            <p className="text-xs text-faint">{intent.email}</p>
          </div>
          <Note tone="warn">
            No real money moves here. In a live church account this step happens on Paystack.
          </Note>
          {intent.status === "pending" ? (
            <div className="flex gap-2">
              <form action={pay} className="flex-1">
                <Button type="submit" variant="primary" size="lg" className="w-full justify-center">
                  Pay {naira(intent.amountKobo)}
                </Button>
              </form>
              <form action={decline}>
                <Button type="submit" size="lg">
                  Decline
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-[13px] text-muted">This payment is already {intent.status}.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
