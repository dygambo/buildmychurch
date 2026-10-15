"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, FilePlus2 } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FormRow } from "@/server/services/forms";
import { createFormAction } from "./actions";

export const FORM_STATUS: Record<FormRow["status"], { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "warn" },
  open: { label: "Open", tone: "good" },
  closed: { label: "Closed", tone: "neutral" },
};

export function FormsView({ forms, templates }: { forms: FormRow[]; templates: { key: string; title: string; description: string }[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Forms"
        description="Sign-ups, surveys and requests with a link and QR code. Answers are stored securely and matched to members when they can be."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <FilePlus2 /> New form
          </Button>
        }
      />
      <Card>
        {forms.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title="No forms yet" action={<Button onClick={() => setCreating(true)}>Start from a template</Button>}>
            Workers&apos; training sign-ups, baptism classes, member surveys, counselling requests. Build one in minutes and share the link.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Form</Th>
                <Th>Status</Th>
                <Th num>Responses</Th>
                <Th className="max-sm:hidden">Latest</Th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <Link href={`/forms/${f.id}`} className="font-medium hover:text-accent">
                      {f.title}
                    </Link>
                    <div className="text-xs text-faint">{f.questions} questions</div>
                  </Td>
                  <Td>
                    <Badge tone={FORM_STATUS[f.status].tone}>{FORM_STATUS[f.status].label}</Badge>
                  </Td>
                  <Td num>
                    <Link href={`/forms/${f.id}/responses`} className="hover:text-accent">
                      {f.responses}
                    </Link>
                  </Td>
                  <Td className="text-xs text-muted max-sm:hidden">{f.last ? timeAgo(f.last) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewFormDialog open={creating} onClose={() => setCreating(false)} templates={templates} />
    </>
  );
}

function NewFormDialog({ open, onClose, templates }: { open: boolean; onClose: () => void; templates: { key: string; title: string; description: string }[] }) {
  const router = useRouter();
  const [pick, setPick] = useState("blank");
  const act = useAction(createFormAction, { onSuccess: (d) => router.push(`/forms/${d.id}`) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="New form"
        description="Start from a template and change anything."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={act.pending} onClick={() => act.run({ template: pick })}>
              Create form
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Template">
          {templates.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={pick === t.key}
              onClick={() => setPick(t.key)}
              className={cn("rounded-lg border px-3 py-2.5 text-left", pick === t.key ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
            >
              <div className="text-[13px] font-medium">{t.title}</div>
              {t.description && <div className="line-clamp-1 text-xs text-muted">{t.description}</div>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
