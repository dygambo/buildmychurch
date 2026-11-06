import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";

export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("events.manage")) return <NoAccess what="manage events" />;
  return <>{children}</>;
}
