"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import { addSlot, assignSlot, autoFill, fillSchema, removeSlot, slotSchema } from "@/server/services/rota";

const uuid = z.string().uuid();

export const fillAction = orgAction({ perm: "volunteers.manage", schema: fillSchema }, async (input, ctx, tx) => {
  const r = await autoFill(tx, ctx, input);
  revalidatePath("/rota");
  return {
    data: r,
    message: r.assigned || r.open ? `${r.assigned} assigned${r.open ? `, ${r.open} left open: not enough people` : ""}${input.notify && r.assigned ? ". Volunteers are told." : ""}` : "Those slots were already filled",
  };
});

export const addSlotAction = orgAction({ perm: "volunteers.manage", schema: slotSchema }, async (input, ctx, tx) => {
  await addSlot(tx, ctx, input);
  revalidatePath("/rota");
  return { data: null, message: "Added" };
});

export const assignAction = orgAction(
  { perm: "volunteers.manage", schema: z.object({ id: uuid, memberId: uuid.nullable() }) },
  async (input, ctx, tx) => {
    await assignSlot(tx, ctx, input);
    revalidatePath("/rota");
    return { data: null, message: input.memberId ? "Assigned. They're told by email or SMS." : "Cleared" };
  },
);

export const removeSlotAction = orgAction({ perm: "volunteers.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await removeSlot(tx, ctx, id);
  revalidatePath("/rota");
  return { data: null, message: "Removed" };
});
