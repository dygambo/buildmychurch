import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui/card";
import { ChurchBranding } from "@/components/brand-style";
import { requestPage } from "@/server/services/counselling";
import { CounsellingRequestForm } from "./form";

export const metadata: Metadata = { title: "Ask for marriage counselling", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CounsellingRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const org = await requestPage(token);
  if (!org)
    return (
      <Card className="w-full max-w-md">
        <CardBody className="text-[13px] text-muted">This link isn&apos;t valid. Ask the church for the right one.</CardBody>
      </Card>
    );
  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="text-center">
        <ChurchBranding orgId={org.id} logo className="mx-auto mb-2 h-12 w-auto max-w-[180px] object-contain" />
        <div className="text-[13px] font-medium text-accent">{org.name}</div>
        <h1 className="mt-1 text-2xl font-semibold">Marriage counselling</h1>
        <p className="mt-1 text-[13px] text-muted">For couples preparing for marriage, and married couples who want support. Everything you share is confidential and seen only by the pastors and your counsellors.</p>
      </div>
      <CounsellingRequestForm token={token} />
    </div>
  );
}
