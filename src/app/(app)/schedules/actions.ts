"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  archiveTemplate,
  deleteSchedule,
  duplicateSchedule,
  publishPreview,
  publishSchedule,
  publishSchema,
  resendNotifications,
  retryFailedNotifications,
  saveAsTemplate,
  saveAsTemplateSchema,
  saveSchedule,
  scheduleSchema,
  searchPeople,
  setArchived,
  startSchedule,
  startSchema,
} from "@/server/services/schedules";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/schedules");
  if (id) revalidatePath(`/schedules/${id}`);
};

export const findPeopleAction = orgAction({ perm: "schedules.manage", schema: z.object({ q: z.string().max(80) }) }, async ({ q }, ctx, tx) =>
  searchPeople(tx, ctx, q),
);

export const startScheduleAction = orgAction({ perm: "schedules.manage", schema: startSchema }, async (input, ctx, tx) => {
  const id = await startSchedule(tx, ctx, input);
  refresh();
  return { data: { id } };
});

export const saveScheduleAction = orgAction({ perm: "schedules.manage", schema: scheduleSchema }, async (input, ctx, tx) => {
  const r = await saveSchedule(tx, ctx, input);
  refresh(r.id);
  return { data: r, message: r.hasChanges ? "Saved. Publish to send the update." : "Saved" };
});

export const publishPreviewAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) =>
  publishPreview(tx, ctx, id),
);

export const publishAction = orgAction({ perm: "schedules.manage", schema: publishSchema }, async (input, ctx, tx) => {
  const r = await publishSchedule(tx, ctx, input);
  refresh(input.id);
  return {
    data: r,
    message: `Version ${r.version} published${r.notified ? `. Notifying ${r.notified} ${r.notified === 1 ? "person" : "people"}.` : "."}`,
  };
});

export const resendAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const n = await resendNotifications(tx, ctx, id);
  refresh(id);
  return { data: n, message: `Sending to ${n} ${n === 1 ? "person" : "people"}` };
});

export const retryAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const n = await retryFailedNotifications(tx, ctx, id);
  refresh(id);
  return { data: n, message: `Retrying ${n}` };
});

export const duplicateAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const newId = await duplicateSchedule(tx, ctx, id);
  refresh();
  return { data: { id: newId }, message: "Copied as a new draft for the following week" };
});

export const archiveAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid, archived: z.boolean() }) }, async ({ id, archived }, ctx, tx) => {
  await setArchived(tx, ctx, id, archived);
  refresh(id);
  return { data: null, message: archived ? "Archived" : "Restored" };
});

export const deleteAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await deleteSchedule(tx, ctx, id);
  refresh();
  return { data: null, message: "Deleted. Published versions stay in the audit record." };
});

export const saveTemplateAction = orgAction({ perm: "schedules.manage", schema: saveAsTemplateSchema }, async (input, ctx, tx) => {
  await saveAsTemplate(tx, ctx, input);
  return { data: null, message: `Saved "${input.name}" as a template` };
});

export const removeTemplateAction = orgAction({ perm: "schedules.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await archiveTemplate(tx, ctx, id);
  refresh();
  return { data: null, message: "Template removed" };
});
