import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { slotForToken } from "@/server/services/rota";
import { RotaResponse } from "./respond";

export const metadata: Metadata = { title: "Your rota", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RotaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await slotForToken(token);
  if (!s || !s.slot.memberId)
    return (
      <Card className="w-full max-w-sm">
        <CardBody className="text-[13px] text-muted">This link isn&apos;t valid any more. Ask your head of department.</CardBody>
      </Card>
    );
  return (
    <Card className="w-full max-w-sm">
      <CardBody className="flex flex-col gap-3 text-center">
        <div className="text-xs font-medium text-accent">{s.church}</div>
        <h1 className="text-lg font-semibold">
          {s.firstName ? `${s.firstName}, you're serving` : "You're serving"}
        </h1>
        <div className="rounded-xl bg-surface-2 px-4 py-3 text-[14px]">
          <div className="font-semibold">{s.slot.position}</div>
          <div className="text-muted">
            {s.groupName} · {formatDate(s.slot.date, "long")}
          </div>
          <div className="text-xs text-faint">{s.slot.serviceLabel}</div>
        </div>
        <RotaResponse token={token} status={s.slot.status} />
      </CardBody>
    </Card>
  );
}
