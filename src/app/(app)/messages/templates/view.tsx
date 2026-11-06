"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useAction } from "@/components/ui/use-action";
import { archiveTemplateAction, saveTemplateAction } from "../actions";
import { CHANNEL } from "../labels";

type T = { id: string; name: string; channel: "sms" | "email" | "whatsapp"; subject: string | null; body: string };

export function TemplatesView({ rows }: { rows: T[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const remove = useAction(archiveTemplateAction, { onSuccess: () => router.refresh() });
  return (
    <>
      <PageHeader
        title="Templates"
        description="Messages you send often. Start a new message from one and change what you need."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus /> New template
          </Button>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText />} title="No templates yet">
            Save the messages you send every week, like service reminders.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {rows.map((t) => (
            <Card key={t.id}>
              <CardBody className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                  <Badge tone={t.channel === "email" ? "purple" : t.channel === "whatsapp" ? "good" : "accent"}>{CHANNEL[t.channel]}</Badge>
                </div>
                {t.subject && <div className="text-[13px] font-medium">{t.subject}</div>}
                <p className="line-clamp-4 flex-1 text-[13px] whitespace-pre-wrap text-muted">{t.body}</p>
                <div className="flex gap-1 border-t border-line pt-2">
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/messages/new?channel=${t.channel}&template=${t.id}`}>
                      <Send /> Use
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    <Pencil /> Edit
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`Remove ${t.name}`} onClick={() => remove.run({ id: t.id })}>
                    <Trash2 />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <TemplateDialog t={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TemplateDialog({ t, onClose }: { t: T | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const x = t && t !== "new" ? t : null;
  const [channel, setChannel] = useState<T["channel"]>(x?.channel ?? "sms");
  const save = useAction(saveTemplateAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={!!t} onOpenChange={(o) => !o && onClose()}>
      {t && (
        <DialogContent
          title={x ? "Edit template" : "New template"}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="tpl-form" variant="primary" loading={save.pending}>
                Save
              </Button>
            </>
          }
        >
          <form
            id="tpl-form"
            key={x?.id ?? "new"}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save.run({
                id: x?.id,
                name: String(f.get("name")),
                channel,
                subject: String(f.get("subject") ?? ""),
                body: String(f.get("body")),
              });
            }}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <Field label="Name" htmlFor="tp-name" error={save.fieldErrors.name}>
                <Input id="tp-name" name="name" defaultValue={x?.name} placeholder="e.g. Sunday reminder" />
              </Field>
              <Field label="For" htmlFor="tp-ch">
                <Select id="tp-ch" value={channel} onChange={(e) => setChannel(e.target.value as T["channel"])}>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </Select>
              </Field>
            </div>
            {channel === "email" && (
              <Field label="Subject" htmlFor="tp-subj" error={save.fieldErrors.subject}>
                <Input id="tp-subj" name="subject" defaultValue={x?.subject ?? ""} />
              </Field>
            )}
            <Field label="Message" htmlFor="tp-body" error={save.fieldErrors.body} hint="Use {first_name}, {full_name} and {church} to personalise it.">
              <Textarea id="tp-body" name="body" rows={6} defaultValue={x?.body} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
