"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  addEntry,
  addPrayer,
  caseSchema,
  closeCase,
  deletePrayer,
  entrySchema,
  markPrayed,
  prayerSchema,
  prayerUpdateSchema,
  reopenCase,
  saveCase,
  updatePrayer,
} from "@/server/services/care";

const uuid = z.string().uuid();
const done = () => revalidatePath("/care");

export const addPrayerAction = orgAction({ perm: "care.manage", schema: prayerSchema }, async (input, ctx, tx) => {
  await addPrayer(tx, ctx, input);
  done();
  return { data: null, message: "Prayer request added" };
});

export const updatePrayerAction = orgAction({ perm: "care.manage", schema: prayerUpdateSchema }, async (input, ctx, tx) => {
  await updatePrayer(tx, ctx, input);
  done();
  return {
    data: null,
    message: input.status === "answered" ? "Marked answered. Praise God!" : input.status === "closed" ? "Closed" : input.testimony !== undefined ? "Testimony saved" : "Updated",
  };
});

export const prayedAction = orgAction({ perm: "care.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const n = await markPrayed(tx, ctx, id);
  done();
  // the card shows the new count, so no toast
  return { data: { n } };
});

export const deletePrayerAction = orgAction({ perm: "care.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await deletePrayer(tx, ctx, id);
  done();
  return { data: null, message: "Removed" };
});

export const saveCaseAction = orgAction({ perm: "care.manage", schema: caseSchema }, async (input, ctx, tx) => {
  const id = await saveCase(tx, ctx, input);
  done();
  revalidatePath(`/care/cases/${id}`);
  return { data: { id }, message: input.id ? "Saved" : "Care record opened" };
});

export const addEntryAction = orgAction({ perm: "care.manage", schema: entrySchema }, async (input, ctx, tx) => {
  await addEntry(tx, ctx, input);
  revalidatePath(`/care/cases/${input.caseId}`);
  done();
  return { data: null, message: input.kind === "welfare" ? "Welfare recorded" : input.kind === "visit" ? "Visit recorded" : input.kind === "call" ? "Call recorded" : "Note added" };
});

export const closeCaseAction = orgAction(
  { perm: "care.manage", schema: z.object({ id: uuid, note: z.string().trim().max(1000).optional().transform((v) => v || null) }) },
  async (input, ctx, tx) => {
    await closeCase(tx, ctx, input);
    revalidatePath(`/care/cases/${input.id}`);
    done();
    return { data: null, message: "Record closed" };
  },
);

export const reopenCaseAction = orgAction({ perm: "care.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await reopenCase(tx, ctx, id);
  revalidatePath(`/care/cases/${id}`);
  done();
  return { data: null, message: "Reopened" };
});
