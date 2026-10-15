import type { Metadata } from "next";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { recentImports, IMPORT_FIELDS } from "@/server/services/imports";
import { NoAccess } from "@/components/no-access";
import { ImportWizard } from "./wizard";

export const metadata: Metadata = { title: "Import members" };

export default async function ImportPage() {
  const ctx = await requireCtx();
  if (!ctx.can("members.import")) return <NoAccess what="import members" />;
  const recent = await withOrg(ctx.org.id, (tx) => recentImports(tx));
  return (
    <ImportWizard
      fields={Object.fromEntries(Object.entries(IMPORT_FIELDS).map(([k, v]) => [k, v.label]))}
      recent={recent
        .filter((r) => r.status !== "validated")
        .map((r) => ({
          id: r.id,
          filename: r.filename,
          status: r.status,
          added: r.validRows,
          total: r.totalRows,
          at: (r.committedAt ?? r.createdAt).toISOString(),
          canUndo: r.canUndo,
        }))}
    />
  );
}
