import { requireCtx } from "@/server/auth/context";
import { NoAccess } from "@/components/no-access";
import { ExpensesTabs } from "./tabs";

export default async function ExpensesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.can("finance.expenses")) return <NoAccess what="use expenses and accounts" />;
  return (
    <>
      <ExpensesTabs canManage={ctx.can("finance.approve")} />
      {children}
    </>
  );
}
