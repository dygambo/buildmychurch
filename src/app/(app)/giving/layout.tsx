import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";
import { GivingTabs } from "./tabs";

export default async function GivingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("giving.read") && !ctx.can("giving.record") && !ctx.can("giving.verify"))
    return <NoAccess what="use giving" />;
  return (
    <>
      <GivingTabs canRead={ctx.can("giving.read")} canManage={ctx.can("giving.verify")} />
      {children}
    </>
  );
}
