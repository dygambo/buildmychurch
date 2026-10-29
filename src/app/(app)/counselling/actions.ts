"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  addChecklistItem,
  assignCounsellors,
  caseSchema,
  completeCase,
  completeSchema,
  recordSchema,
  recordSession,
  saveCase,
  scheduleSession,
  sessionSchema,
  setCaseStatus,
  toggleChecklist,
} from "@/server/services/counselling";

const uuid = z.string().uuid();
const perm = undefined; // access is checked in the service (counselling.manage or counselling.oversee)
const touch = (id?: string) => {
  revalidatePath("/counselling");
  if (id) revalidatePath(`/counselling/${id}`);
};

export const saveCaseAction = orgAction({ perm, schema: caseSchema }, async (input, ctx, tx) => {
  const id = await saveCase(tx, ctx, input);
  touch(id);
  return { data: { id }, message: input.id ? "Saved" : "Counselling record opened" };
});

export const assignAction = orgAction({ perm, schema: z.object({ id: uuid, counsellorIds: z.array(uuid).max(3) }) }, async (input, ctx, tx) => {
  await assignCounsellors(tx, ctx, input);
  touch(input.id);
  return { data: null, message: "Counsellors updated" };
});

export const statusAction = orgAction({ perm, schema: z.object({ id: uuid, status: z.enum(["active", "on_hold", "closed"]) }) }, async (input, ctx, tx) => {
  await setCaseStatus(tx, ctx, input);
  touch(input.id);
  return { data: null, message: input.status === "on_hold" ? "Put on hold" : input.status === "closed" ? "Closed" : "Counselling resumed" };
});

export const checklistAction = orgAction(
  { perm, schema: z.object({ id: uuid, key: z.string().max(40), done: z.boolean(), note: z.string().max(300).optional().nullable() }) },
  async (input, ctx, tx) => {
    await toggleChecklist(tx, ctx, input);
    touch(input.id);
    return { data: null };
  },
);

export const addChecklistAction = orgAction({ perm, schema: z.object({ id: uuid, label: z.string().max(120) }) }, async (input, ctx, tx) => {
  await addChecklistItem(tx, ctx, input);
  touch(input.id);
  return { data: null, message: "Added to the checklist" };
});

export const sessionAction = orgAction({ perm, schema: sessionSchema }, async (input, ctx, tx) => {
  await scheduleSession(tx, ctx, input);
  touch(input.caseId);
  return { data: null, message: input.id ? "Session moved" : input.notify ? "Session planned. The couple has been told." : "Session planned" };
});

export const recordAction = orgAction({ perm, schema: recordSchema.extend({ caseId: uuid }) }, async ({ caseId, ...input }, ctx, tx) => {
  await recordSession(tx, ctx, input);
  touch(caseId);
  return { data: null, message: input.status === "held" ? (input.homework ? "Recorded. The homework was sent to the couple." : "Recorded") : input.status === "missed" ? "Marked as missed" : "Cancelled" };
});

export const completeAction = orgAction({ perm, schema: completeSchema }, async (input, ctx, tx) => {
  const cert = await completeCase(tx, ctx, input);
  touch(input.id);
  return { data: { cert }, message: cert ? `Completed and cleared. Certificate ${cert} is ready to print.` : "Counselling completed" };
});
