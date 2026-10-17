"use client";
import { useState } from "react";
import Link from "next/link";
import { Building, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate, naira } from "@/lib/format";
import { CampaignDialog } from "./campaign-form";

type Campaign = {
  id: string;
  name: string;
  fundName: string;
  goalKobo: number;
  raised: number;
  pledged: number;
  pledgers: number;
  status: string;
  endsOn: string | null;
};

export function CampaignsView({
  campaigns,
  funds,
  canManage,
}: {
  campaigns: Campaign[];
  funds: { id: string; name: string; restricted: boolean }[];
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Projects and pledges"
        description="Track pledges against each project and see how much has actually come in."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> New project
            </Button>
          )
        }
      />
      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building />}
            title="No projects yet"
            action={
              canManage && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus /> New project
                </Button>
              )
            }
          >
            Start a project for a building, a bus or a mission. Record pledges, and every gift to it counts towards the
            goal and the giver&apos;s pledge.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {campaigns.map((c) => {
            const pct = c.goalKobo ? Math.round((c.raised / c.goalKobo) * 100) : 0;
            return (
              <Link
                key={c.id}
                href={`/giving/pledges/${c.id}`}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent-line"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold">{c.name}</h3>
                    <p className="text-xs text-faint">
                      Into {c.fundName}
                      {c.endsOn && ` · target ${formatDate(c.endsOn)}`}
                    </p>
                  </div>
                  {c.status === "closed" && <Badge>Closed</Badge>}
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <b className="tabular text-lg">{naira(c.raised, { compact: true })}</b>
                    <span className="tabular text-[13px] text-muted">of {naira(c.goalKobo, { compact: true })}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-good" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>{pct}% raised</span>
                  <span>
                    {c.pledgers} pledge{c.pledgers === 1 ? "" : "s"} · {naira(c.pledged, { compact: true })} pledged
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <CampaignDialog open={creating} onOpenChange={setCreating} funds={funds} />
    </>
  );
}
