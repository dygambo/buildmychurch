import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";
import { ChildrenTabs } from "./tabs";

export default async function ChildrenLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("children.checkin") && !ctx.can("children.manage")) return <NoAccess what="use children's ministry" />;
  return (
    <>
      <ChildrenTabs canManage={ctx.can("children.manage")} />
      {children}
    </>
  );
}
