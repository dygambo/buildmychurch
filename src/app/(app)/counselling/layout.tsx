import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";

export default async function CounsellingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("counselling.manage") && !ctx.can("counselling.oversee")) return <NoAccess what="open marriage counselling" />;
  return <>{children}</>;
}
