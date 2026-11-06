import { ChurchBranding } from "@/components/brand-style";
import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui/card";
import { publicForm } from "@/server/services/forms";
import { PublicForm } from "./form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const f = await publicForm((await params).token);
  return { title: f ? `${f.form.title} · ${f.church}` : "Form", robots: { index: false } };
}

export default async function FormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await publicForm(token);
  if (!f)
    return (
      <Card className="w-full max-w-md">
        <CardBody className="text-[13px] text-muted">This form link isn&apos;t valid. Ask the church for the right one.</CardBody>
      </Card>
    );
  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="text-center">
        <ChurchBranding orgId={f.orgId} logo className="mx-auto mb-2 h-12 w-auto max-w-[180px] object-contain" />
        <div className="text-[13px] font-medium text-accent">{f.church}</div>
        <h1 className="mt-1 text-2xl font-semibold text-balance">{f.form.title}</h1>
        {f.form.description && <p className="mt-1.5 text-[13px] whitespace-pre-wrap text-muted">{f.form.description}</p>}
      </div>
      {f.closed ? (
        <Card>
          <CardBody className="text-center text-[13px] text-muted">{f.closed}</CardBody>
        </Card>
      ) : (
        <PublicForm token={token} fields={f.form.fields} />
      )}
    </div>
  );
}
