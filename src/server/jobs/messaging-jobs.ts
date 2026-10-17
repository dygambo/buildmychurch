import { registerJob } from "./registry";
import { deliverMessages, prepareCampaign, requeueStuckMessages, runAutomations } from "../services/messaging";

/** Works out the recipients of a broadcast or automatic message and queues one message each. */
registerJob("messages.prepare", async (job) => {
  const { campaignId } = job.payload as { campaignId: string };
  await prepareCampaign(job.orgId!, campaignId);
});

/** Hands up to 100 queued messages to the SMS, email or WhatsApp provider. */
registerJob("messages.deliver", async (job) => {
  const { ids } = job.payload as { ids: string[] };
  await deliverMessages(job.orgId!, ids);
});

/** Each morning: birthdays, anniversaries, first-timer welcomes and pledge reminders. */
registerJob("messaging.automations", async (job) => {
  const { date } = job.payload as { date?: string };
  await runAutomations(job.orgId!, date);
});

registerJob("messages.requeue", async () => {
  await requeueStuckMessages();
});
