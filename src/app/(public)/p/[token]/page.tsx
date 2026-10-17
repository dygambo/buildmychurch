import { ChurchBranding } from "@/components/brand-style";
import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui/card";
import { publicPrayerPage } from "@/server/services/care";
import { PrayerForm } from "./form";

export const metadata: Metadata = { title: "Send a prayer request", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrayerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const org = await publicPrayerPage(token);
  if (!org)
    return (
      <Card className="w-full max-w-md">
        <CardBody className="text-[13px] text-muted">This prayer page link isn&apos;t valid. Ask the church for the right one.</CardBody>
      </Card>
    );
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="text-center">
        <ChurchBranding orgId={org.id} logo className="mx-auto mb-2 h-12 w-auto max-w-[180px] object-contain" />
        <div className="text-[13px] font-medium text-accent">{org.name}</div>
        <h1 className="mt-1 text-2xl font-semibold">How can we pray with you?</h1>
        <p className="mt-1 text-[13px] text-muted">Our prayer team reads every request. You don&apos;t have to give your name.</p>
      </div>
      <PrayerForm token={token} />
    </div>
  );
}
