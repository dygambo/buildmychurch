import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { env } from "@/server/env";
import { paymentsProvider } from "@/server/providers/payments";
import { settlePayment, getIntent } from "@/server/services/payments";
import { smsBalance, smsLedgerPage, TOPUP_BUNDLES } from "@/server/services/messaging";
import { NoAccess } from "@/components/no-access";
import { WalletView } from "./view";

export const metadata: Metadata = { title: "SMS units" };

export default async function WalletPage({ searchParams }: { searchParams: Promise<{ ref?: string; reference?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("messaging.manage")) return <NoAccess what="manage SMS units" />;
  const sp = await searchParams;
  const ref = sp.ref ?? sp.reference;
  let justPaid: "succeeded" | "failed" | "pending" | null = null;
  if (ref) {
    const intent = await getIntent(ref);
    if (intent && intent.orgId === ctx.org.id && intent.purpose === "sms_topup") {
      const out = await settlePayment(ref);
      justPaid = out === "succeeded" ? "succeeded" : out === "pending" ? "pending" : "failed";
    }
  }
  const data = await withOrg(ctx.org.id, async (tx) => ({ balance: await smsBalance(tx), ledger: await smsLedgerPage(tx, ctx) }));
  let testMode = false;
  try {
    testMode = paymentsProvider() === "fake";
  } catch {}
  return (
    <WalletView
      balance={data.balance}
      ledger={data.ledger.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
      bundles={[...TOPUP_BUNDLES]}
      unitPriceKobo={env().SMS_UNIT_PRICE_KOBO}
      justPaid={justPaid}
      testMode={testMode}
    />
  );
}
