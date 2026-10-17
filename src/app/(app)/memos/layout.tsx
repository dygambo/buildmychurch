import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";

export default async function MemosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("memo.create")) return <NoAccess what="use E-Memo" />;
  return <>{children}</>;
}
