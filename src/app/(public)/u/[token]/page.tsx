import type { Metadata } from "next";
import { CheckCircle2, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { unsubscribeInfo } from "@/server/services/messaging";
import { unsubscribeAction } from "../../actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const info = await unsubscribeInfo(decodeURIComponent(token));
  if (!info)
    return (
      <Card className="w-full max-w-sm">
        <CardBody className="text-[13px] text-muted">This unsubscribe link isn&apos;t valid. Reply to the email and the church will take you off the list.</CardBody>
      </Card>
    );
  const off = done === "1" || !info.subscribed;
  return (
    <Card className="w-full max-w-sm">
      <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
        {off ? <CheckCircle2 className="size-9 text-good" /> : <MailX className="size-9 text-accent" />}
        <h1 className="text-lg font-semibold">{off ? "You're unsubscribed" : `Stop messages from ${info.church}?`}</h1>
        <p className="text-[13px] text-muted">
          {off
            ? `${info.church} won't send you announcements or newsletters. You'll still get receipts and messages you ask for.`
            : `Hi ${info.firstName}, you'll stop getting announcements and newsletters by email, SMS and WhatsApp. Receipts still come.`}
        </p>
        {!off && (
          <form action={unsubscribeAction.bind(null, decodeURIComponent(token))}>
            <Button type="submit" variant="primary">
              Unsubscribe me
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
