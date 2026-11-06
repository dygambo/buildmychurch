"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, CalendarClock, Copy, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Note, Stat } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDateTime } from "@/lib/format";
import type { getCampaign } from "@/server/services/messaging";
import { cancelCampaignAction, retryFailedAction } from "../actions";
import { CAMPAIGN_STATUS, CHANNEL, MESSAGE_STATUS, SKIP } from "../labels";

type C = Awaited<ReturnType<typeof getCampaign>>;

export function CampaignDetail({ c, status }: { c: C; status: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const cancel = useAction(cancelCampaignAction, { onSuccess: () => router.refresh() });
  const retry = useAction(retryFailedAction, { onSuccess: () => router.refresh() });
  const st = CAMPAIGN_STATUS[c.status]!;
  // keep the numbers moving while it sends
  useEffect(() => {
    if (c.status !== "sending" && !(c.status === "scheduled" && c.scheduledAt && new Date(c.scheduledAt).getTime() < Date.now() + 60_000)) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [c.status, c.scheduledAt, router]);
  const href = (v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set("status", v);
    else next.delete("status");
    next.delete("page");
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  const deliveredPct = c.counts.sent ? Math.round((c.counts.delivered / c.counts.sent) * 100) : 0;
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/messages">
            <ArrowLeft /> Messages
          </Link>
        </Button>
      </div>
      <PageHeader
        title={c.name}
        description={`${CHANNEL[c.channel]} · ${c.kind === "automation" ? "Automatic" : `by ${c.createdByName}`} · ${formatDateTime(c.scheduledAt ?? c.createdAt)}`}
        actions={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            {c.status === "scheduled" && (
              <Button variant="ghost" loading={cancel.pending} onClick={() => cancel.run({ id: c.id })}>
                <Ban /> Cancel
              </Button>
            )}
            {c.kind === "broadcast" && (
              <Button asChild variant="ghost">
                <Link href={`/messages/new?channel=${c.channel}`}>
                  <Copy /> New {CHANNEL[c.channel]}
                </Link>
              </Button>
            )}
          </>
        }
      />
      {c.status === "scheduled" && (
        <Note tone="accent" icon={<CalendarClock className="size-4" />}>
          Sends {formatDateTime(c.scheduledAt!)}. Recipients are worked out then, so anyone added before that is included.
        </Note>
      )}
      {c.status === "failed" && c.failureReason && <Note tone="bad">{c.failureReason}</Note>}
      {c.counts.failed > 0 && c.status !== "sending" && (
        <Note tone="warn">
          <span className="flex flex-wrap items-center gap-3">
            {c.counts.failed} message{c.counts.failed === 1 ? "" : "s"} failed.
            <Button size="sm" loading={retry.pending} onClick={() => retry.run({ id: c.id })}>
              <RotateCw /> Resend failed
            </Button>
          </span>
        </Note>
      )}
      {c.counts.total > 0 && (
        <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          <Stat label="Sent" value={c.counts.sent.toLocaleString("en-NG")} sub={c.counts.queued ? `${c.counts.queued} still going out` : undefined} />
          <Stat
            label="Delivered"
            value={c.channel === "email" ? "—" : c.counts.delivered.toLocaleString("en-NG")}
            sub={c.channel === "email" ? "Email providers don't report delivery" : c.counts.sent ? `${deliveredPct}% of sent` : undefined}
          />
          <Stat label="Failed" value={c.counts.failed.toLocaleString("en-NG")} tone={c.counts.failed ? "bad" : undefined} />
          <Stat
            label={c.channel === "sms" ? "SMS units" : "Not sent"}
            value={c.channel === "sms" ? c.unitsUsed.toLocaleString("en-NG") : c.counts.skipped.toLocaleString("en-NG")}
            sub={c.channel === "sms" ? `${c.counts.skipped} not sent` : undefined}
          />
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-start gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader title="What was sent" />
          <CardBody className="flex flex-col gap-2 text-[13px]">
            {c.subject && <div className="font-semibold">{c.sample?.subject ?? c.subject}</div>}
            <div className="rounded-lg bg-surface-2 px-3 py-2 whitespace-pre-wrap">{c.sample?.body ?? c.body}</div>
            {c.sample && c.sample.body !== c.body && <p className="text-xs text-faint">Shown as the first person received it. Each person sees their own name.</p>}
            {c.skips.length > 0 && (
              <div className="mt-2 border-t border-line pt-2">
                <div className="mb-1 text-xs font-medium text-muted">Not sent</div>
                <ul className="flex flex-col gap-1 text-xs text-muted">
                  {c.skips.map((s) => (
                    <li key={s.reason} className="flex justify-between gap-2">
                      <span>{SKIP[s.reason]}</span>
                      <b className="tabular">{s.n}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <div className="border-b border-line px-3 py-2.5">
            <LinkTabs
              current={status || "all"}
              tabs={[
                { key: "all", label: "Everyone", href: href(""), count: c.counts.total },
                { key: "delivered", label: "Delivered", href: href("delivered"), count: c.counts.delivered },
                { key: "failed", label: "Failed", href: href("failed"), count: c.counts.failed },
                { key: "skipped", label: "Not sent", href: href("skipped"), count: c.counts.skipped },
              ]}
            />
          </div>
          {c.list.length === 0 ? (
            <EmptyState title={c.status === "scheduled" ? "Not sent yet" : "No one here"}>
              {c.status === "scheduled" ? "The list appears when it sends." : "Try another tab."}
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Status</Th>
                  <Th className="max-md:hidden">When</Th>
                </tr>
              </thead>
              <tbody>
                {c.list.map((m) => {
                  const ms = MESSAGE_STATUS[m.status]!;
                  return (
                    <Tr key={m.id}>
                      <Td>
                        {m.memberId ? (
                          <Link href={`/members/${m.memberId}`} className="font-medium hover:text-accent">
                            {m.recipientName}
                          </Link>
                        ) : (
                          <span className="font-medium">{m.recipientName ?? "—"}</span>
                        )}
                        {m.toMasked && <div className="font-mono text-xs text-faint">{m.toMasked}</div>}
                      </Td>
                      <Td>
                        <Badge tone={ms.tone}>{ms.label}</Badge>
                        {m.skipReason && <div className="mt-0.5 text-xs text-muted">{SKIP[m.skipReason]}</div>}
                        {m.status === "failed" && m.error && <div className="mt-0.5 line-clamp-2 text-xs text-bad">{m.error}</div>}
                      </Td>
                      <Td className="text-xs text-muted max-md:hidden">
                        {m.deliveredAt ? formatDateTime(m.deliveredAt) : m.sentAt ? formatDateTime(m.sentAt) : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <Pagination
            page={c.page}
            pageSize={50}
            total={c.listTotal}
            hrefFor={(p) => {
              const next = new URLSearchParams(sp.toString());
              next.set("page", String(p));
              return `${path}?${next}`;
            }}
          />
        </Card>
      </div>
    </>
  );
}
