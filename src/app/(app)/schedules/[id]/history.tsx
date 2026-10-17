"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Mail, MessageSquareText, RotateCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Note } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDateTime } from "@/lib/format";
import type { NotificationRow } from "@/server/services/schedules";
import { resendAction, retryAction } from "../actions";
import { NOTIFY_STATUS, REASON } from "../labels";

type Version = {
  id: string;
  version: number;
  changeSummary: string | null;
  note: string | null;
  publishedByName: string;
  publishedAt: Date;
  pdfStatus: string;
  pdfError: string | null;
};

export function ScheduleHistory({
  s,
  notifications,
}: {
  s: { id: string; title: string; currentVersion: number; versions: Version[] };
  notifications: NotificationRow[];
}) {
  const router = useRouter();
  const resend = useAction(resendAction, { onSuccess: () => router.refresh() });
  const retry = useAction(retryAction, { onSuccess: () => router.refresh() });
  const waiting = notifications.some((n) => n.status === "pending") || s.versions.some((v) => v.pdfStatus === "pending");
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [waiting, router]);
  const failed = notifications.filter((n) => n.status === "failed").length;
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/schedules/${s.id}`}>
            <ArrowLeft /> Back to the schedule
          </Link>
        </Button>
      </div>
      <PageHeader
        title={s.title}
        description="Every published version with its PDF, and every notification: sent means the provider accepted it; delivered only when the network confirmed it."
        actions={
          s.currentVersion > 0 && (
            <>
              {failed > 0 && (
                <Button loading={retry.pending} onClick={() => retry.run({ id: s.id })}>
                  <RotateCw /> Retry {failed} failed
                </Button>
              )}
              <Button variant="primary" loading={resend.pending} onClick={() => resend.run({ id: s.id })}>
                <Send /> Resend to everyone
              </Button>
            </>
          )
        }
      />
      <Card>
        <CardHeader title={`Versions (${s.versions.length})`} />
        {s.versions.length === 0 ? (
          <EmptyState title="Not published yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>What changed</Th>
                <Th className="max-md:hidden">Published</Th>
                <Th className="w-28">PDF</Th>
              </tr>
            </thead>
            <tbody>
              {s.versions.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <span className="font-semibold">v{v.version}</span>
                    {v.version === s.currentVersion && (
                      <Badge tone="good" className="ml-2">
                        Current
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {v.changeSummary}
                    {v.note && <div className="text-xs text-muted">Note: {v.note}</div>}
                  </Td>
                  <Td className="text-muted max-md:hidden">
                    {v.publishedByName}
                    <div className="text-xs text-faint">{formatDateTime(v.publishedAt)}</div>
                  </Td>
                  <Td>
                    {v.pdfStatus === "ready" ? (
                      <a href={`/schedules/${s.id}/pdf?v=${v.version}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[13px] text-accent">
                        <FileText className="size-4" /> v{v.version}.pdf
                      </a>
                    ) : v.pdfStatus === "pending" ? (
                      <span className="text-xs text-muted">Making…</span>
                    ) : (
                      <span className="text-xs text-bad" title={v.pdfError ?? undefined}>
                        Couldn&apos;t make the PDF
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={`Notifications (${notifications.length})`} />
        {notifications.length === 0 ? (
          <EmptyState title="No notifications yet">People named from the member list or team are notified when you publish.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="max-sm:hidden">Why</Th>
                <Th>Status</Th>
                <Th className="max-md:hidden">When</Th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => {
                const st = NOTIFY_STATUS[n.status]!;
                return (
                  <Tr key={n.id}>
                    <Td>
                      <div className="font-medium">{n.recipientName}</div>
                      {n.toMasked && (
                        <div className="flex items-center gap-1 font-mono text-xs text-faint">
                          {n.channel === "email" ? <Mail className="size-3" /> : <MessageSquareText className="size-3" />} {n.toMasked}
                        </div>
                      )}
                    </Td>
                    <Td className="max-sm:hidden">
                      {REASON[n.reason]} · v{n.version}
                      {n.detail && <div className="line-clamp-1 max-w-sm text-xs text-muted">{n.detail}</div>}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {n.status === "sent" && n.channel === "email" && <div className="mt-0.5 text-xs text-faint">Accepted by the email provider</div>}
                      {n.error && n.status === "failed" && <div className="mt-0.5 max-w-xs text-xs text-bad">{n.error}</div>}
                      {n.attempts > 1 && <div className="text-xs text-faint">{n.attempts} attempts</div>}
                    </Td>
                    <Td className="text-xs text-muted max-md:hidden">
                      {n.deliveredAt ? formatDateTime(n.deliveredAt) : n.sentAt ? formatDateTime(n.sentAt) : formatDateTime(n.createdAt)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {waiting && <Note tone="accent">Sending… this page updates by itself.</Note>}
    </>
  );
}
