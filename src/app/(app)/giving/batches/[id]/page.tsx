import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { DENOMINATIONS, getBatch, listFunds } from "@/server/services/giving";
import { BatchDetail } from "./detail";

export const metadata: Metadata = { title: "Collection" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const data = await withOrg(ctx.org.id, async (tx) => ({
    batch: await getBatch(tx, ctx, id),
    funds: await listFunds(tx),
  }));
  const b = data.batch;
  return (
    <BatchDetail
      batch={{
        id: b.id,
        batchNo: b.batchNo,
        kind: b.kind,
        label: b.label,
        givenOn: String(b.givenOn),
        status: b.status,
        totalKobo: b.totalKobo,
        cashCount: b.cashCount,
        notes: b.notes,
        countedByName: b.countedByName,
        verifiedByName: b.verifiedByName,
        submittedAt: b.submittedAt?.toISOString() ?? null,
        verifiedAt: b.verifiedAt?.toISOString() ?? null,
        rejectionNote: b.rejectionNote,
        serviceName: b.serviceName,
        branchName: b.branchName,
        isCounter: b.isCounter,
        canEdit: b.canEdit,
        canVerify: b.canVerify,
        lines: b.lines,
      }}
      funds={data.funds.map((f) => ({ id: f.id, name: f.name }))}
      denominations={[...DENOMINATIONS]}
      verifierRole={ctx.can("giving.verify")}
    />
  );
}
