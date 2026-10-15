import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { AppError } from "@/server/errors";
import { listGroups } from "@/server/services/groups";
import { getMemo, listMemoTemplates, listRoute } from "@/server/services/memos";
import { listBranches } from "@/server/services/org";
import { MemoForm } from "./form";

export const metadata: Metadata = { title: "New memo" };

export default async function NewMemoPage({ searchParams }: { searchParams: Promise<{ template?: string; edit?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const data = await withOrg(ctx.org.id, async (tx) => {
    let existing = null;
    if (sp.edit) {
      try {
        existing = await getMemo(tx, ctx, sp.edit);
      } catch (e) {
        if (e instanceof AppError) notFound();
        throw e;
      }
      if (!existing.canEdit) notFound();
    }
    return {
      existing,
      templates: await listMemoTemplates(tx),
      route: (await listRoute(tx)).steps,
      groups: (await listGroups(tx, ctx)).filter((g) => g.kind !== "cell"),
      branches: (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id)),
    };
  });
  const e = data.existing;
  return (
    <MemoForm
      initial={
        e
          ? {
              id: e.id,
              branchId: e.branchId,
              templateId: e.templateId,
              category: e.category,
              title: e.title,
              body: e.body,
              amount: e.amountKobo ? String(e.amountKobo / 100) : "",
              departmentId: e.departmentId,
              memberId: e.member?.id ?? null,
              memberName: e.member ? `${e.member.firstName} ${e.member.lastName}` : null,
              urgent: e.urgent,
              confidential: e.confidential,
              status: e.status,
            }
          : { id: randomUUID(), branchId: data.branches[0]?.id ?? "", templateId: sp.template ?? null, status: "draft" }
      }
      templates={data.templates.map((t) => ({ id: t.id, name: t.name, category: t.category, subject: t.subject, body: t.body, needsAmount: t.needsAmount }))}
      route={data.route.map((r) => ({ label: r.label, minAmountKobo: r.minAmountKobo }))}
      groups={data.groups.map((g) => ({ id: g.id, name: g.name }))}
      branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
      canPickMember={ctx.can("members.read")}
    />
  );
}
