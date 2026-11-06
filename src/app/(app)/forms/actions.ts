"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import { createForm, deleteForm, deleteResponse, duplicateForm, formSchema, saveForm, setFormStatus } from "@/server/services/forms";

const uuid = z.string().uuid();

export const createFormAction = orgAction({ perm: "forms.manage", schema: z.object({ template: z.string().max(40) }) }, async ({ template }, ctx, tx) => {
  const id = await createForm(tx, ctx, template);
  revalidatePath("/forms");
  return { data: { id } };
});

export const saveFormAction = orgAction({ perm: "forms.manage", schema: formSchema }, async (input, ctx, tx) => {
  await saveForm(tx, ctx, input);
  revalidatePath("/forms");
  revalidatePath(`/forms/${input.id}`);
  return { data: null, message: "Form saved" };
});

export const formStatusAction = orgAction(
  { perm: "forms.manage", schema: z.object({ id: uuid, status: z.enum(["open", "closed", "draft"]) }) },
  async ({ id, status }, ctx, tx) => {
    await setFormStatus(tx, ctx, id, status);
    revalidatePath("/forms");
    revalidatePath(`/forms/${id}`);
    return { data: null, message: status === "open" ? "The form is open. Share the link." : status === "closed" ? "The form is closed" : "Back to draft" };
  },
);

export const duplicateFormAction = orgAction({ perm: "forms.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const n = await duplicateForm(tx, ctx, id);
  revalidatePath("/forms");
  return { data: { id: n }, message: "Copied" };
});

export const deleteFormAction = orgAction({ perm: "forms.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await deleteForm(tx, ctx, id);
  revalidatePath("/forms");
  return { data: null, message: "Form deleted" };
});

export const deleteResponseAction = orgAction({ perm: "forms.manage", schema: z.object({ id: uuid, formId: uuid }) }, async ({ id, formId }, ctx, tx) => {
  await deleteResponse(tx, ctx, id);
  revalidatePath(`/forms/${formId}/responses`);
  return { data: null, message: "Response deleted" };
});
