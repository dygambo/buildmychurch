"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Copy, Lock, LockOpen, Pencil, Plus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import { formatDate, naira } from "@/lib/format";
import { MemberPicker } from "../../../members/member-picker";
import { addPledgeAction, campaignStatusAction, cancelPledgeAction, findGiversAction } from "../../actions";
import { CampaignDialog } from "../campaign-form";

type Pledge = {
  id: string;
  memberId: string | null;
  name: string;
  memberNo: string | null;
  amountKobo: number;
  paidKobo: number;
  dueOn: string | null;
  status: string;
  note: string | null;
};
type C = {
  id: string;
  name: string;
  description: string | null;
  fundId: string;
  fundName: string;
  goalKobo: number;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
  showOnline: boolean;
  raised: number;
  pledged: number;
  pledgers: number;
  pledges: Pledge[];
};

export function CampaignDetail({
  c,
  funds,
  giveUrl,
  can,
}: {
  c: C;
  funds: { id: string; name: string; restricted: boolean }[];
  giveUrl: string;
  can: { manage: boolean; pledge: boolean; named: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Pledge | null>(null);
  const status = useAction(campaignStatusAction);
  const pct = c.goalKobo ? Math.round((c.raised / c.goalKobo) * 100) : 0;
  const live = c.pledges.filter((p) => p.status !== "cancelled");
  const paidOnPledges = live.reduce((s, p) => s + Math.min(p.paidKobo, p.amountKobo), 0);
  const fulfilled = live.filter((p) => p.status === "fulfilled").length;

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/giving/pledges">
            <ArrowLeft /> Projects
          </Link>
        </Button>
      </div>
      <PageHeader
        title={c.name}
        description={
          <>
            Gifts go into {c.fundName}
            {c.endsOn && ` · target ${formatDate(c.endsOn, "long")}`}
          </>
        }
        actions={
          <>
            {c.status === "closed" && <Badge>Closed</Badge>}
            {can.manage && (
              <>
                <Button onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  variant="ghost"
                  loading={status.pending}
                  onClick={() => status.run({ id: c.id, status: c.status === "active" ? "closed" : "active" })}
                >
                  {c.status === "active" ? (
                    <>
                      <Lock /> Close
                    </>
                  ) : (
                    <>
                      <LockOpen /> Reopen
                    </>
                  )}
                </Button>
              </>
            )}
            {can.pledge && c.status === "active" && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> Record a pledge
              </Button>
            )}
          </>
        }
      />
      {c.description && <p className="max-w-3xl text-[13px] text-muted">{c.description}</p>}

      <Card>
        <CardBody className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <b className="tabular text-2xl">{naira(c.raised)}</b>
            <span className="tabular text-muted">of {naira(c.goalKobo)} goal</span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Raised towards the goal"
          >
            <div className="h-full rounded-full bg-good" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="text-xs text-muted">{pct}% raised · {naira(Math.max(0, c.goalKobo - c.raised), { compact: true })} to go</div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label="Pledged" value={naira(c.pledged, { compact: true })} sub={`${c.pledgers} pledge${c.pledgers === 1 ? "" : "s"}`} />
        <Stat label="Paid on pledges" value={naira(paidOnPledges, { compact: true })} sub={c.pledged ? `${Math.round((paidOnPledges / c.pledged) * 100)}% of what was pledged` : "—"} />
        <Stat label="Pledges fulfilled" value={`${fulfilled} of ${live.length}`} />
        <Stat label="Gifts without a pledge" value={naira(Math.max(0, c.raised - paidOnPledges), { compact: true })} sub="Online and envelope gifts" />
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Card>
          <CardHeader title="Pledges" />
          {c.pledges.length === 0 ? (
            <EmptyState icon={<UserRound />} title="No pledges yet">
              Record pledges as people make them. Their gifts to this project then count towards what they promised.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Pledger</Th>
                  <Th num>Pledged</Th>
                  <Th num>Paid</Th>
                  <Th className="max-md:hidden">Progress</Th>
                  <Th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {c.pledges.map((p) => {
                  const pp = Math.min(100, Math.round((p.paidKobo / p.amountKobo) * 100));
                  return (
                    <Tr key={p.id} className={p.status === "cancelled" ? "opacity-50" : undefined}>
                      <Td>
                        {p.memberId ? (
                          <Link href={`/members/${p.memberId}`} className="font-medium hover:text-accent">
                            {p.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{p.name}</span>
                        )}
                        <div className="text-xs text-faint">
                          {p.status === "fulfilled" ? (
                            <span className="text-good">Fulfilled</span>
                          ) : p.status === "cancelled" ? (
                            "Cancelled"
                          ) : p.dueOn ? (
                            `Due ${formatDate(p.dueOn)}`
                          ) : (
                            `${naira(p.amountKobo - Math.min(p.paidKobo, p.amountKobo))} to go`
                          )}
                        </div>
                      </Td>
                      <Td num>{naira(p.amountKobo)}</Td>
                      <Td num className="font-medium">
                        {naira(p.paidKobo)}
                      </Td>
                      <Td className="max-md:hidden">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className={p.status === "fulfilled" ? "h-full bg-good" : "h-full bg-accent"}
                            style={{ width: `${pp}%` }}
                          />
                        </div>
                      </Td>
                      <Td>
                        {can.manage && p.status === "open" && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Cancel ${p.name}'s pledge`} onClick={() => setCancelling(p)}>
                            <Ban />
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        {c.status === "active" && c.showOnline && (
          <Card className="self-start">
            <CardHeader title="Give to this project" />
            <CardBody className="flex flex-col items-center gap-3 text-center">
              <QrImage value={giveUrl} size={150} label={`QR code to give to ${c.name}`} />
              <p className="text-[13px] text-muted">Print this or put it on screen. It opens the giving page with this project chosen.</p>
              <Button
                size="sm"
                onClick={() =>
                  navigator.clipboard.writeText(giveUrl).then(
                    () => toast.success("Link copied"),
                    () => toast.error("Couldn't copy the link"),
                  )
                }
              >
                <Copy /> Copy link
              </Button>
            </CardBody>
          </Card>
        )}
      </div>

      <CampaignDialog
        open={editing}
        onOpenChange={setEditing}
        funds={funds}
        initial={{ id: c.id, name: c.name, description: c.description, fundId: c.fundId, goalKobo: c.goalKobo, startsOn: c.startsOn, endsOn: c.endsOn, showOnline: c.showOnline }}
      />
      <PledgeDialog open={adding} onOpenChange={setAdding} campaignId={c.id} />
      <CancelPledgeDialog pledge={cancelling} campaignId={c.id} onClose={() => setCancelling(null)} />
    </>
  );
}

function PledgeDialog({ open, onOpenChange, campaignId }: { open: boolean; onOpenChange: (o: boolean) => void; campaignId: string }) {
  const [member, setMember] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState("");
  const save = useAction(addPledgeAction, {
    onSuccess: () => {
      onOpenChange(false);
      setMember(null);
      setName("");
      setAmount("");
      setDueOn("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="Record a pledge"
          footer={
            <>
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={() =>
                  save.run({ campaignId, memberId: member?.id ?? "", pledgerName: member ? "" : name, amount, dueOn })
                }
              >
                Save pledge
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-muted">Who pledged?</span>
            {member ? (
              <div className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-[13px]">
                <UserRound className="size-4 text-faint" />
                <span className="flex-1 font-medium">{member.name}</span>
                <button type="button" aria-label="Choose someone else" onClick={() => setMember(null)}>
                  <X className="size-4 text-faint" />
                </button>
              </div>
            ) : (
              <>
                <MemberPicker autoFocus search={findGiversAction} onPick={(m) => setMember({ id: m.id, name: m.name })} />
                <Input
                  aria-label="Or type the name of someone who isn't a member"
                  placeholder="Or type the name of someone who isn't a member"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {save.fieldErrors.pledgerName && <p className="text-xs text-bad">{save.fieldErrors.pledgerName}</p>}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount pledged (₦)" htmlFor="pl-amount" error={save.fieldErrors.amount}>
              <Input id="pl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Redeem by" htmlFor="pl-due" optional>
              <Input id="pl-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </Field>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function CancelPledgeDialog({ pledge, campaignId, onClose }: { pledge: Pledge | null; campaignId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const act = useAction(cancelPledgeAction, { onSuccess: onClose });
  return (
    <Dialog open={!!pledge} onOpenChange={(o) => !o && onClose()}>
      {pledge && (
        <DialogContent
          title={`Cancel ${pledge.name}'s pledge?`}
          description={`${naira(pledge.amountKobo)} pledged, ${naira(pledge.paidKobo)} paid. Gifts already made still count towards the project.`}
          footer={
            <>
              <Button onClick={onClose}>Keep it</Button>
              <Button variant="danger" loading={act.pending} onClick={() => act.run({ id: pledge.id, campaignId, reason })}>
                Cancel pledge
              </Button>
            </>
          }
        >
          <Field label="Reason" htmlFor="cp-reason" error={act.fieldErrors.reason}>
            <Textarea id="cp-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </DialogContent>
      )}
    </Dialog>
  );
}
