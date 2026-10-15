import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { FORM_TEMPLATES, listForms } from "@/server/services/forms";
import { FormsView } from "./view";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsPage() {
  const ctx = await requireCtx();
  const list = await withOrg(ctx.org.id, (tx) => listForms(tx, ctx));
  return <FormsView forms={list} templates={FORM_TEMPLATES.map((t) => ({ key: t.key, title: t.title, description: t.description }))} />;
}
