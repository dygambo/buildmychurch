import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { publicSchedule } from "@/server/services/schedules";
import { ScheduleDocument } from "../../../(app)/schedules/[id]/viewer";

export const metadata: Metadata = { title: "Service schedule", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Opened from the link in a notification. Shows the latest published version, nothing private. */
export default async function SharedSchedule({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await publicSchedule(token);
  if (!s)
    return (
      <Card className="w-full max-w-md">
        <CardBody className="text-[13px] text-muted">This schedule link has expired or been withdrawn. Ask the church office for the latest schedule.</CardBody>
      </Card>
    );
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <ScheduleDocument snap={s.snap} church={s.church} />
      <div className="flex flex-wrap items-center gap-2">
        {s.pdfReady && (
          <Button asChild variant="primary">
            <a href={`/s/${token}/pdf`}>
              <FileText /> Download PDF
            </a>
          </Button>
        )}
        <span className="text-xs text-muted">
          Version {s.version}, published {formatDateTime(s.publishedAt)}. This page always shows the latest version.
        </span>
      </div>
    </div>
  );
}
