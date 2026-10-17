import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";

export default async function CareLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("care.manage")) return <NoAccess what="see prayer requests and pastoral care" />;
  return <>{children}</>;
}
