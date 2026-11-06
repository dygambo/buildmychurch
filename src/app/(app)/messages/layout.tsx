import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";
import { MessagesTabs } from "./tabs";

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("messaging.send") && !ctx.can("messaging.manage")) return <NoAccess what="send messages" />;
  return (
    <>
      <MessagesTabs canManage={ctx.can("messaging.manage")} />
      {children}
    </>
  );
}
