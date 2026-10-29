import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";

export default async function FormsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("forms.manage")) return <NoAccess what="build forms or read responses" />;
  return <>{children}</>;
}
