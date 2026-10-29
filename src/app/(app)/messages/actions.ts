"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  archiveTemplate,
  audienceSchema,
  automationSchema,
  campaignSchema,
  cancelCampaign,
  createCampaign,
  previewAudience,
  retryFailed,
  saveAutomation,
  saveTemplate,
  sendTest,
  startTopup,
  templateSchema,
  testSchema,
  topupSchema,
} from "@/server/services/messaging";

const uuid = z.string().uuid();

export const previewAction = orgAction(
  { perm: "messaging.send", schema: z.object({ audience: audienceSchema, channel: z.enum(["sms", "email", "whatsapp"]), body: z.string().max(5000) }) },
  async ({ audience, channel, body }, ctx, tx) => previewAudience(tx, ctx, audience, channel, body),
);

export const sendCampaignAction = orgAction({ perm: "messaging.send", schema: campaignSchema }, async (input, ctx, tx) => {
  const r = await createCampaign(tx, ctx, input);
  revalidatePath("/messages");
  return {
    data: r,
    message: input.scheduleAt
      ? `Scheduled for ${r.reachable.toLocaleString("en-NG")} ${r.reachable === 1 ? "person" : "people"}`
      : `Sending to ${r.reachable.toLocaleString("en-NG")} ${r.reachable === 1 ? "person" : "people"}`,
  };
});

export const sendTestAction = orgAction({ perm: "messaging.send", schema: testSchema }, async (input, ctx, tx) => {
  const r = await sendTest(tx, ctx, input);
  return { data: r, message: `Test sent to ${r.to}` };
});

export const cancelCampaignAction = orgAction({ perm: "messaging.send", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await cancelCampaign(tx, ctx, id);
  revalidatePath("/messages");
  revalidatePath(`/messages/${id}`);
  return { data: null, message: "Cancelled. Nothing was sent." };
});

export const retryFailedAction = orgAction({ perm: "messaging.send", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const n = await retryFailed(tx, ctx, id);
  revalidatePath(`/messages/${id}`);
  return { data: n, message: `Resending ${n} message${n === 1 ? "" : "s"}` };
});

export const saveTemplateAction = orgAction({ perm: "messaging.manage", schema: templateSchema }, async (input, ctx, tx) => {
  await saveTemplate(tx, ctx, input);
  revalidatePath("/messages/templates");
  return { data: null, message: input.id ? "Template updated" : "Template saved" };
});

export const archiveTemplateAction = orgAction({ perm: "messaging.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await archiveTemplate(tx, ctx, id);
  revalidatePath("/messages/templates");
  return { data: null, message: "Template removed" };
});

export const saveAutomationAction = orgAction({ perm: "messaging.manage", schema: automationSchema }, async (input, ctx, tx) => {
  await saveAutomation(tx, ctx, input);
  revalidatePath("/messages/automations");
  return { data: null, message: input.enabled ? "On. It runs every morning at 7am." : "Turned off" };
});

export const topupAction = orgAction({ perm: "messaging.manage", schema: topupSchema }, async (input, ctx, tx) => {
  const r = await startTopup(tx, ctx, input);
  return { data: r };
});
