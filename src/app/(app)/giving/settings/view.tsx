"use client";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, BadgeCheck, Copy, Landmark, Pencil, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formToObject, useAction } from "@/components/ui/use-action";
import { QrImage } from "@/components/qr";
import type { GivingSettings } from "@/server/services/giving";
import {
  archiveFundAction,
  banksAction,
  receiptSettingsAction,
  resolveAccountAction,
  saveFundAction,
  saveSettlementAction,
} from "../actions";
import { COLOR_VAR } from "../labels";

type Fund = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  restricted: boolean;
  online: boolean;
  color: string;
  archived: boolean;
};

export function GivingSettingsView({
  funds,
  settings,
  mode,
  givingUrl,
  canPayout,
}: {
  funds: Fund[];
  settings: GivingSettings;
  mode: "fake" | "paystack" | "off";
  givingUrl: string;
  canPayout: boolean;
}) {
  const [editing, setEditing] = useState<Fund | "new" | null>(null);
  const archive = useAction(archiveFundAction);
  const receipts = useAction(receiptSettingsAction);
  return (
    <>
      <PageHeader title="Giving settings" description="Funds, where online gifts are paid out, and receipts." />

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <Payout settings={settings} mode={mode} canPayout={canPayout} />
        <Card>
          <CardHeader title="Your giving page" />
          <CardBody className="flex items-start gap-4 max-sm:flex-col">
            <QrImage value={givingUrl} size={120} label="QR code for your giving page" />
            <div className="flex min-w-0 flex-col gap-2 text-[13px]">
              <p className="text-muted">Put this on screen during the offering, on the bulletin, or on a poster at the entrance.</p>
              <code className="truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-xs">{givingUrl.replace(/^https?:\/\//, "")}</code>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    navigator.clipboard.writeText(givingUrl).then(
                      () => toast.success("Link copied"),
                      () => toast.error("Couldn't copy the link"),
                    )
                  }
                >
                  <Copy /> Copy link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.print()}>
                  <Printer /> Print
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Funds"
          action={
            <Button size="sm" variant="soft" onClick={() => setEditing("new")}>
              <Plus /> Add fund
            </Button>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Fund</Th>
              <Th className="max-sm:hidden">Code</Th>
              <Th className="max-md:hidden">Online</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <Tr key={f.id} className={f.archived ? "opacity-55" : undefined}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm" style={{ background: COLOR_VAR[f.color] }} />
                    <span className="font-medium">{f.name}</span>
                    {f.restricted && <Badge tone="purple">Restricted</Badge>}
                    {f.archived && <Badge>Closed</Badge>}
                  </span>
                  {f.description && <div className="text-xs text-faint">{f.description}</div>}
                </Td>
                <Td className="font-mono text-xs max-sm:hidden">{f.code}</Td>
                <Td className="text-muted max-md:hidden">{f.online ? "Shown" : "Hidden"}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={f.archived ? `Reopen ${f.name}` : `Close ${f.name}`}
                    onClick={() => archive.run({ id: f.id, archived: !f.archived })}
                  >
                    {f.archived ? <ArchiveRestore /> : <Archive />}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <CardBody className="pt-2 text-xs text-faint">
          Restricted funds, like a building project or welfare, may only be spent on their purpose. Closing a fund hides
          it from new gifts; its history stays.
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Receipts" />
        <CardBody>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              receipts.run(formToObject(e.currentTarget) as Parameters<typeof receiptSettingsAction>[0]);
            }}
          >
            <p className="text-[13px] text-muted">
              Online givers always get an emailed receipt. Receipts carry a number in sequence for the year, e.g.
              R-2026-000123.
            </p>
            <Checkbox
              name="receiptsForOffline"
              defaultChecked={settings.receiptsForOffline}
              label="Also email receipts for named envelopes and transfers, when the member has an email address"
            />
            <Checkbox
              name="smsReceipts"
              defaultChecked={settings.smsReceipts}
              label="Send a short SMS receipt instead when there's a phone number but no email (uses SMS units)"
            />
            <Field label="Thank-you message on receipts" htmlFor="ty" optional hint="Shown above the receipt details.">
              <Textarea
                id="ty"
                name="thankYouMessage"
                rows={2}
                defaultValue={settings.thankYouMessage ?? ""}
                placeholder="Thank you for your faithful giving. God bless you."
              />
            </Field>
            <div>
              <Button type="submit" variant="primary" loading={receipts.pending}>
                Save
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <FundDialog fund={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function Payout({ settings, mode, canPayout }: { settings: GivingSettings; mode: string; canPayout: boolean }) {
  const [changing, setChanging] = useState(false);
  const live = !!settings.subaccountCode;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Landmark className="size-4" /> Where online gifts are paid
          </span>
        }
        action={
          <Badge tone={live ? "good" : mode === "fake" ? "warn" : "neutral"} dot>
            {live ? "Connected" : mode === "fake" ? "Test mode" : "Not set up"}
          </Badge>
        }
      />
      <CardBody className="flex flex-col gap-3 text-[13px]">
        {mode === "fake" && (
          <Note tone="warn">
            Payments are in test mode: givers see a practice checkout and no money moves. Set PAYMENTS_PROVIDER=paystack
            on the server to take real gifts.
          </Note>
        )}
        {live ? (
          <div className="flex items-center gap-3 rounded-xl border border-line p-3">
            <BadgeCheck className="size-5 text-good" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{settings.accountName}</div>
              <div className="text-muted">
                {settings.bankName} ••••{settings.accountLast4}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted">
            Choose the church bank account. Paystack pays gifts into it, usually the next working day, minus Paystack&apos;s
            fee (1.5% + ₦100, capped at ₦2,000). Build My Church takes nothing from gifts.
          </p>
        )}
        {canPayout ? (
          changing ? (
            <SettlementForm onDone={() => setChanging(false)} />
          ) : (
            <div>
              <Button variant={live ? "secondary" : "primary"} onClick={() => setChanging(true)}>
                {live ? "Change account" : "Add bank account"}
              </Button>
            </div>
          )
        ) : (
          <p className="text-xs text-faint">Only a Super Admin or Finance Officer can change the payout account.</p>
        )}
      </CardBody>
    </Card>
  );
}

function SettlementForm({ onDone }: { onDone: () => void }) {
  const [banks, setBanks] = useState<{ code: string; name: string }[] | null>(null);
  const [bank, setBank] = useState("");
  const [acct, setAcct] = useState("");
  const [resolved, setResolved] = useState<string | null>(null);
  const loadBanks = useAction(banksAction, { onSuccess: setBanks });
  const resolve = useAction(resolveAccountAction, { onSuccess: (d) => setResolved(d.accountName) });
  const save = useAction(saveSettlementAction, { onSuccess: onDone });
  const run = loadBanks.run;
  useEffect(() => {
    run({});
  }, [run]);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label="Bank" htmlFor="st-bank">
          <Select
            id="st-bank"
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
              setResolved(null);
            }}
            disabled={!banks}
          >
            <option value="">{banks ? "Choose the bank" : "Loading banks…"}</option>
            {banks?.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account number" htmlFor="st-acct" error={resolve.fieldErrors.accountNumber}>
          <Input
            id="st-acct"
            inputMode="numeric"
            maxLength={10}
            value={acct}
            onChange={(e) => {
              setAcct(e.target.value.replace(/\D/g, ""));
              setResolved(null);
            }}
          />
        </Field>
      </div>
      {resolved && (
        <Note tone="good" icon={<BadgeCheck />}>
          This account belongs to <b>{resolved}</b>. If that&apos;s right, save it.
        </Note>
      )}
      <div className="flex gap-2">
        <Button onClick={onDone}>Cancel</Button>
        {resolved ? (
          <Button
            variant="primary"
            loading={save.pending}
            onClick={() => save.run({ bankCode: bank, bankName: banks?.find((b) => b.code === bank)?.name ?? bank, accountNumber: acct })}
          >
            Save account
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!bank || acct.length !== 10}
            loading={resolve.pending}
            onClick={() => resolve.run({ bankCode: bank, accountNumber: acct })}
          >
            Check account name
          </Button>
        )}
      </div>
    </div>
  );
}

function FundDialog({ fund, onClose }: { fund: Fund | "new" | null; onClose: () => void }) {
  const save = useAction(saveFundAction, { onSuccess: onClose });
  const f = fund === "new" ? null : fund;
  return (
    <Dialog open={!!fund} onOpenChange={(o) => !o && onClose()}>
      {fund && (
        <DialogContent
          title={f ? `Edit ${f.name}` : "Add a fund"}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" type="submit" form="fund-form" loading={save.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="fund-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              save.run({ ...formToObject(e.currentTarget), id: f?.id } as Parameters<typeof saveFundAction>[0]);
            }}
          >
            <Field label="Name" htmlFor="fd-name" error={save.fieldErrors.name}>
              <Input id="fd-name" name="name" required defaultValue={f?.name} placeholder="e.g. Missions" />
            </Field>
            <Field label="Code" htmlFor="fd-code" error={save.fieldErrors.code} hint="Short, for exports and accounting">
              <Input id="fd-code" name="code" required defaultValue={f?.code} placeholder="MISSIONS" className="uppercase" />
            </Field>
            <Field label="Description" htmlFor="fd-desc" optional className="col-span-full">
              <Input id="fd-desc" name="description" defaultValue={f?.description ?? ""} />
            </Field>
            <Field label="Colour in charts" htmlFor="fd-color">
              <Select id="fd-color" name="color" defaultValue={f?.color ?? "c1"}>
                {["c1", "c2", "c3", "c4", "c5", "c6"].map((c, i) => (
                  <option key={c} value={c}>
                    {["Blue", "Pink", "Teal", "Amber", "Purple", "Sky"][i]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="col-span-full flex flex-col gap-2">
              <Checkbox name="restricted" defaultChecked={f?.restricted} label="Restricted: money may only be spent on this fund's purpose" />
              <Checkbox name="online" defaultChecked={f?.online ?? true} label="Show on the online giving page" />
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
