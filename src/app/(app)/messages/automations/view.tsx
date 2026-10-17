"use client";
import { useState } from "react";
import { Cake, Gift, HandCoins, Heart, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { smsInfo } from "@/lib/sms";
import { saveAutomationAction } from "../actions";

type Item = { key: "birthday" | "anniversary" | "welcome" | "pledge"; label: string; when: string; enabled: boolean; channel: "sms" | "email" | "whatsapp"; body: string };
const ICONS = { birthday: Cake, anniversary: Heart, welcome: Gift, pledge: HandCoins };

export function AutomationsView({ items, church, whatsapp }: { items: Item[]; church: string; whatsapp: boolean }) {
  return (
    <>
      <PageHeader
        title="Automatic messages"
        description="Sent every morning at 7am to the people they're for. Birthday, anniversary and welcome messages only go to people who agreed to messages."
      />
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {items.map((i) => (
          <AutomationCard key={i.key} item={i} church={church} whatsapp={whatsapp} />
        ))}
      </div>
    </>
  );
}

function AutomationCard({ item, church, whatsapp }: { item: Item; church: string; whatsapp: boolean }) {
  const [enabled, setEnabled] = useState(item.enabled);
  const [channel, setChannel] = useState(item.channel);
  const [body, setBody] = useState(item.body);
  const save = useAction(saveAutomationAction);
  const Icon = ICONS[item.key];
  const info = smsInfo(body.replace(/\{first_name\}/g, "Oluwaseun").replace(/\{church\}/g, church));
  const dirty = enabled !== item.enabled || channel !== item.channel || body !== item.body;
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-semibold">
              {item.label}
              {item.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}
            </div>
            <div className="text-[13px] text-muted">{item.when}</div>
          </div>
        </div>
        <Field label="Message" htmlFor={`a-${item.key}`} error={save.fieldErrors.body}>
          <Textarea id={`a-${item.key}`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox label={`Send ${item.label.toLowerCase()} messages`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <Select aria-label={`${item.label} channel`} value={channel} onChange={(e) => setChannel(e.target.value as Item["channel"])} className="h-8 w-32 text-[13px]">
            <option value="sms">By SMS</option>
            <option value="email">By email</option>
            {whatsapp && <option value="whatsapp">By WhatsApp</option>}
          </Select>
          {channel === "sms" && (
            <span className="text-xs text-faint">
              {info.pages} page{info.pages === 1 ? "" : "s"} per person
            </span>
          )}
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={!dirty}
            loading={save.pending}
            onClick={() => save.run({ key: item.key, enabled, channel, body })}
          >
            <Save /> Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
