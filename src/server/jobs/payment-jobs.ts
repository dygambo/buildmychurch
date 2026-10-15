import { registerJob } from "./registry";
import { reconcilePayments } from "../services/payments";
import { withOrg } from "../db";
import { calculateRemittances, previousPeriod } from "../services/expenses";

/** Every 15 minutes: re-checks online payments that haven't been confirmed by a webhook yet. */
registerJob("payments.reconcile", async () => {
  await reconcilePayments();
});

/** On the 1st of each month: works out what each branch owes headquarters for the month just ended. */
registerJob("finance.remittances", async (job) => {
  const orgId = job.orgId!;
  const { period } = job.payload as { period?: string };
  await withOrg(orgId, (tx) => calculateRemittances(tx, orgId, period ?? previousPeriod()));
});
