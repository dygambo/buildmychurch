"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Copy, Gem, Plus, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { QrImage } from "@/components/qr";
import { formatDate, formatTime } from "@/lib/format";
import type { CaseListRow } from "@/server/services/counselling";
import { CaseDialog } from "./case-dialog";
import { KIND_LABEL, OUTCOME_LABEL, STATUS } from "./labels";

type Upcoming = { id: string; caseId: string; couple: string; topic: string; startsAt: Date; location: string | null; counsellor: string | null; mine: boolean };

export function CounsellingView({
  cases,
  counts,
  upcoming,
  team,
  branches,
  link,
  filters,
  canOversee,
}: {
  cases: CaseListRow[];
  counts: { enquiry: number; active: number; on_hold: number; cleared: number };
  upcoming: Upcoming[];
  team: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  link: string;
  filters: Record<string, string | undefined>;
  canOversee: boolean;
  me: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const go = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const tabHref = (t: string) => {
    const next = new URLSearchParams(sp.toString());
    if (t === "open") next.delete("tab");
    else next.set("tab", t);
    return `${path}?${next}`;
  };
  const tab = filters.tab ?? "open";
  return (
    <>
      <PageHeader
        title="Marriage counselling"
        description="Pre-marital counselling for couples getting married, and support for married couples. Only pastors and each couple's counsellors can see their record."
        actions={
          <>
            <Button onClick={() => setSharing(true)}>
              <QrCode /> Request page
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> New couple
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label="New enquiries" value={counts.enquiry} sub={canOversee ? "Waiting for a counsellor" : "Assigned by a pastor"} />
        <Stat label="In counselling" value={counts.active} sub={counts.on_hold ? `${counts.on_hold} on hold` : "None on hold"} />
        <Stat label="Sessions in the next 2 weeks" value={upcoming.length} sub={upcoming[0] ? `Next: ${formatDate(upcoming[0].startsAt, "week")}` : "Nothing planned"} />
        <Stat label="Cleared for marriage this year" value={counts.cleared} sub="Certificates issued" />
      </div>
      <div className="grid grid-cols-[1fr_300px] gap-4 max-xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-3">
          <LinkTabs
            className="self-start"
            current={tab}
            tabs={[
              { key: "open", label: "Open", href: tabHref("open") },
              { key: "enquiry", label: "New enquiries", href: tabHref("enquiry"), count: counts.enquiry || undefined },
              { key: "active", label: "In counselling", href: tabHref("active") },
              { key: "on_hold", label: "On hold", href: tabHref("on_hold") },
              { key: "completed", label: "Completed", href: tabHref("completed") },
              { key: "closed", label: "Closed", href: tabHref("closed") },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox placeholder="Search names or reference" className="w-64 max-sm:w-full" />
            <Select aria-label="Kind" value={filters.kind ?? ""} onChange={(e) => go("kind", e.target.value)} className="w-48">
              <option value="">Both kinds</option>
              <option value="premarital">Pre-marital</option>
              <option value="marital">Marriage support</option>
            </Select>
            {canOversee && <Checkbox label="Only couples I counsel" checked={filters.mine === "1"} onChange={(e) => go("mine", e.target.checked ? "1" : "")} />}
          </div>
          <Card>
            {cases.length === 0 ? (
              <EmptyState
                icon={<Gem />}
                title={tab === "open" ? "No couples in counselling" : "Nothing here"}
                action={
                  <Button onClick={() => setCreating(true)}>
                    <Plus /> Add a couple
                  </Button>
                }
              >
                Share the request page so couples can ask for counselling, or add a couple yourself.
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Couple</Th>
                    <Th className="max-md:hidden">Counsellors</Th>
                    <Th>Progress</Th>
                    <Th className="max-sm:hidden">Next</Th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={`/counselling/${c.id}`} className="font-medium hover:text-accent">
                          {c.couple}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span className="font-mono">{c.refNo}</span>
                          <span>· {KIND_LABEL[c.kind]}</span>
                          <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                          {c.source === "online" && c.status === "enquiry" && <span className="text-faint">from the request page</span>}
                        </div>
                      </Td>
                      <Td className="text-[13px] max-md:hidden">{c.counsellors.length ? c.counsellors.join(", ") : <span className="text-faint">Not assigned</span>}</Td>
                      <Td className="text-[13px]">
                        {c.status === "completed" ? (
                          <span className="text-good">{c.outcome ? OUTCOME_LABEL[c.outcome] : "Completed"}</span>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (c.held / Math.max(1, c.planned)) * 100)}%` }} />
                              </span>
                              <span className="text-xs text-muted tabular">
                                {c.held}/{c.planned}
                              </span>
                            </div>
                            {c.kind === "premarital" && c.checklistOpen > 0 && <div className="text-xs text-faint">{c.checklistOpen} requirements open</div>}
                          </>
                        )}
                      </Td>
                      <Td className="text-[13px] max-sm:hidden">
                        {c.next ? (
                          <>
                            {formatDate(c.next, "week")}
                            <div className="text-xs text-faint">{formatTime(c.next)}</div>
                          </>
                        ) : c.weddingDate && c.status !== "completed" ? (
                          <span className="text-xs text-muted">Wedding {formatDate(c.weddingDate, "short")}</span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Coming up" />
          {upcoming.length === 0 ? (
            <CardBody className="text-[13px] text-muted">No sessions in the next two weeks.</CardBody>
          ) : (
            <ul className="flex flex-col" data-testid="upcoming-sessions">
              {upcoming.map((u) => (
                <li key={u.id} className="border-t border-line first:border-t-0">
                  <Link href={`/counselling/${u.caseId}`} className="flex gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <div className="w-11 shrink-0 rounded-lg bg-accent-soft py-1 text-center text-accent">
                      <div className="text-[10px] font-semibold uppercase">{formatDate(u.startsAt, "short").split(" ")[1]}</div>
                      <div className="text-base leading-none font-bold">{formatDate(u.startsAt, "short").split(" ")[0]}</div>
                    </div>
                    <div className="min-w-0 text-[13px]">
                      <div className="truncate font-medium">{u.couple}</div>
                      <div className="truncate text-xs text-muted">{u.topic}</div>
                      <div className="flex items-center gap-1 text-xs text-faint">
                        <CalendarClock className="size-3" /> {formatTime(u.startsAt)}
                        {u.counsellor && !u.mine ? ` · ${u.counsellor}` : ""}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <CaseDialog open={creating} onClose={() => setCreating(false)} team={team} branches={branches} canOversee={canOversee} />
      <Dialog open={sharing} onOpenChange={setSharing}>
        <DialogContent title="Counselling request page" description="Couples can ask for pre-marital or marriage counselling here. Pastors get an email and assign a counsellor. Share it at service, in the bulletin or in your WhatsApp groups.">
          <div className="flex flex-col items-center gap-3">
            <QrImage value={link} size={180} label="QR code for the counselling request page" />
            <code className="max-w-full truncate rounded bg-surface-2 px-2 py-1 font-mono text-xs">{link}</code>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  navigator.clipboard.writeText(link).then(
                    () => toast.success("Link copied"),
                    () => toast.error("Couldn't copy the link"),
                  )
                }
              >
                <Copy /> Copy link
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={link} target="_blank" rel="noopener">
                  Open
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
