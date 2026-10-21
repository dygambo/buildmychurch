"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Inbox, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { FormField } from "@/server/db/schema/care";
import { deleteResponseAction } from "../../actions";

type Answer = string | string[] | null;
type R = { id: string; name: string | null; memberId: string | null; memberName: string | null; answers: Record<string, Answer>; createdAt: Date };
type T = { id: string; label: string; answered: number; counts: Record<string, number> };

const show = (q: FormField, a: Answer | undefined) => {
  if (a === null || a === undefined || a === "") return "—";
  if (Array.isArray(a)) return a.join(", ");
  if (q.type === "date") return formatDate(a);
  if (q.type === "phone") return formatPhone(a);
  return a;
};

export function ResponsesView({ form, responses, tallies }: { form: { id: string; title: string; fields: FormField[] }; responses: R[]; tallies: T[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const del = useAction(deleteResponseAction, { onSuccess: () => router.refresh() });
  const qs = form.fields.filter((q) => q.type !== "section");
  const cols = qs.slice(0, 4);
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/forms/${form.id}`}>
            <ArrowLeft /> {form.title}
          </Link>
        </Button>
      </div>
      <PageHeader
        title="Responses"
        description={`${responses.length} ${responses.length === 1 ? "response" : "responses"} to ${form.title}`}
        actions={
          responses.length > 0 && (
            <Button asChild>
              <a href={`/forms/${form.id}/responses/export`}>
                <Download /> Excel
              </a>
            </Button>
          )
        }
      />
      {tallies.length > 0 && responses.length > 0 && (
        <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
          {tallies.map((t) => {
            const max = Math.max(1, ...Object.values(t.counts));
            return (
              <Card key={t.id}>
                <CardHeader title={t.label} action={<span className="text-xs text-faint">{t.answered} answered</span>} />
                <CardBody className="flex flex-col gap-1.5">
                  {Object.entries(t.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([o, n]) => (
                      <div key={o} className="flex items-center gap-2 text-[13px]">
                        <span className="w-40 shrink-0 truncate">{o}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${(n / max) * 100}%` }} />
                        </span>
                        <span className="w-14 text-right tabular text-muted">
                          {n} {t.answered ? `(${Math.round((n / t.answered) * 100)}%)` : ""}
                        </span>
                      </div>
                    ))}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      <Card>
        {responses.length === 0 ? (
          <EmptyState icon={<Inbox />} title="No responses yet">
            Open the form and share its link. Responses appear here as they come in.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Submitted</Th>
                {cols.map((q) => (
                  <Th key={q.id} className="max-md:[&:nth-child(n+3)]:hidden">
                    {q.label}
                  </Th>
                ))}
                <Th />
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <Fragment key={r.id}>
                  <Tr className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <Td className="text-xs whitespace-nowrap text-muted">
                      {formatDateTime(r.createdAt)}
                      {r.memberId && (
                        <div>
                          <Link href={`/members/${r.memberId}`} onClick={(e) => e.stopPropagation()} className="text-accent">
                            {r.memberName}
                          </Link>
                        </div>
                      )}
                    </Td>
                    {cols.map((q) => (
                      <Td key={q.id} className="max-w-56 truncate text-[13px] max-md:[&:nth-child(n+3)]:hidden">
                        {show(q, r.answers[q.id])}
                      </Td>
                    ))}
                    <Td className="w-10">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete response"
                        onClick={(e) => {
                          e.stopPropagation();
                          del.run({ id: r.id, formId: form.id });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </Td>
                  </Tr>
                  {open === r.id && (
                    <tr className="bg-surface-2">
                      <td colSpan={cols.length + 2} className="px-4 py-3">
                        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-1.5 text-[13px] max-sm:grid-cols-1">
                          {qs.map((q) => (
                            <div key={q.id} className="contents">
                              <dt className="text-muted">{q.label}</dt>
                              <dd className="whitespace-pre-wrap">{show(q, r.answers[q.id])}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
