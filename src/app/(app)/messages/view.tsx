"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarClock, Mail, MessageCircle, MessageSquareText, Repeat, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Note, Stat } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { CampaignRow } from "@/server/services/messaging";
import { CAMPAIGN_STATUS, CHANNEL } from "./labels";

const ICON = { sms: MessageSquareText, email: Mail, whatsapp: MessageCircle } as const;

export function MessagesView({
  list,
  stats,
  filters,
  whatsapp,
  canManage,
}: {
  list: { rows: CampaignRow[]; total: number; page: number; pageSize: number } | null;
  stats: { sent30: number; delivered30: number; trackable30: number; failed30: number; sms30: number; members: number; consenting: number; balance: number };
  filters: { status: string; channel: string };
  whatsapp: boolean;
  canManage: boolean;
}) {
  const path = usePathname();
  const sp = useSearchParams();
  const href = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  const deliveredPct = stats.trackable30 ? Math.round((stats.delivered30 / stats.trackable30) * 100) : null;
  const consentPct = stats.members ? Math.round((stats.consenting / stats.members) * 100) : 0;
  return (
    <>
      <PageHeader
        title="Messaging"
        description="Send SMS, email and WhatsApp to your members, and see who got each message."
        actions={
          list && (
            <>
              <Button asChild variant="primary">
                <Link href="/messages/new?channel=sms">
                  <MessageSquareText /> New SMS
                </Link>
              </Button>
              <Button asChild>
                <Link href="/messages/new?channel=email">
                  <Mail /> Email
                </Link>
              </Button>
              {whatsapp && (
                <Button asChild>
                  <Link href="/messages/new?channel=whatsapp">
                    <MessageCircle /> WhatsApp
                  </Link>
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat
          label="SMS units"
          value={stats.balance.toLocaleString("en-NG")}
          tone={stats.balance < 50 ? "bad" : undefined}
          sub={
            canManage ? (
              <Link href="/messages/wallet" className="text-accent">
                Buy units
              </Link>
            ) : (
              "One unit is one SMS page to one phone"
            )
          }
        />
        <Stat label="Sent in 30 days" value={stats.sent30.toLocaleString("en-NG")} sub={`${stats.sms30.toLocaleString("en-NG")} by SMS`} />
        <Stat
          label="Delivered"
          value={deliveredPct === null ? "—" : `${deliveredPct}%`}
          sub={stats.failed30 ? `${stats.failed30} failed · SMS and WhatsApp` : "SMS and WhatsApp, as the networks report"}
        />
        <Stat
          label="Can be messaged"
          value={`${consentPct}%`}
          sub={`${stats.consenting.toLocaleString("en-NG")} of ${stats.members.toLocaleString("en-NG")} people agreed`}
        />
      </div>
      {consentPct < 60 && stats.members > 0 && (
        <Note tone="warn">
          Broadcasts only go to people who agreed to receive messages, as the data protection law requires. Ask members to
          tick the box on their visitor card or profile, or record their consent when you import them.
        </Note>
      )}
      {list && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <LinkTabs
              className="self-start"
              current={filters.status || "all"}
              tabs={[
                { key: "all", label: "All", href: href("status", "") },
                { key: "scheduled", label: "Scheduled", href: href("status", "scheduled") },
                { key: "automation", label: "Automatic", href: href("status", "automation") },
              ]}
            />
            <LinkTabs
              className="self-start"
              current={filters.channel || "any"}
              tabs={[
                { key: "any", label: "Any channel", href: href("channel", "") },
                { key: "sms", label: "SMS", href: href("channel", "sms") },
                { key: "email", label: "Email", href: href("channel", "email") },
                ...(whatsapp ? [{ key: "whatsapp", label: "WhatsApp", href: href("channel", "whatsapp") }] : []),
              ]}
            />
          </div>
          <Card>
            {list.rows.length === 0 ? (
              <EmptyState
                icon={<Send />}
                title={filters.status || filters.channel ? "Nothing here" : "No messages yet"}
                action={
                  !filters.status &&
                  !filters.channel && (
                    <Button asChild variant="primary">
                      <Link href="/messages/new?channel=sms">
                        <MessageSquareText /> Send your first SMS
                      </Link>
                    </Button>
                  )
                }
              >
                {filters.status || filters.channel
                  ? "Try another filter."
                  : "Remind people about Sunday service, share news, or wish someone a happy birthday."}
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Message</Th>
                    <Th className="max-md:hidden">When</Th>
                    <Th num>Sent to</Th>
                    <Th num className="max-sm:hidden">
                      Delivered
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((c) => {
                    const Icon = ICON[c.channel];
                    const st = CAMPAIGN_STATUS[c.status]!;
                    const reach = c.recipients - c.skipped;
                    return (
                      <Tr key={c.id}>
                        <Td>
                          <div className="flex items-start gap-2.5">
                            <Icon className="mt-0.5 size-4 shrink-0 text-faint" aria-label={CHANNEL[c.channel]} />
                            <div className="min-w-0">
                              <Link href={`/messages/${c.id}`} className="line-clamp-1 font-medium hover:text-accent">
                                {c.name}
                              </Link>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                                <Badge tone={st.tone}>{st.label}</Badge>
                                {c.kind === "automation" && (
                                  <span className="flex items-center gap-1">
                                    <Repeat className="size-3" /> Automatic
                                  </span>
                                )}
                                {c.kind !== "automation" && <span>by {c.createdByName}</span>}
                              </div>
                            </div>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-muted max-md:hidden">
                          {c.status === "scheduled" && <CalendarClock className="mr-1 inline size-3.5" />}
                          {formatDateTime(c.scheduledAt ?? c.createdAt)}
                        </Td>
                        <Td num>
                          {c.status === "scheduled" || c.status === "cancelled" ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <>
                              <span className="font-medium">{(c.status === "sending" ? c.sent : reach).toLocaleString("en-NG")}</span>
                              {c.skipped > 0 && <div className="text-xs text-faint">{c.skipped} not sent</div>}
                            </>
                          )}
                        </Td>
                        <Td num className="max-sm:hidden">
                          {c.channel === "email" ? (
                            <span className="text-faint" title="Email providers don't report delivery">
                              —
                            </span>
                          ) : c.sent ? (
                            <>
                              {Math.round((c.delivered / c.sent) * 100)}%
                              {c.failed > 0 && <div className="text-xs text-bad">{c.failed} failed</div>}
                            </>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              hrefFor={(p) => {
                const next = new URLSearchParams(sp.toString());
                next.set("page", String(p));
                return `${path}?${next}`;
              }}
            />
          </Card>
        </>
      )}
    </>
  );
}
