import { registerJob } from "./registry";
import { reconcilePayments } from "../services/payments";

/** Every 15 minutes: re-checks online payments that haven't been confirmed by a webhook yet. */
registerJob("payments.reconcile", async () => {
  await reconcilePayments();
});
