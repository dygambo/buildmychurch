"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  addComment,
  answerQuery,
  approveMemo,
  archiveMemoTemplate,
  commentSchema,
  decisionSchema,
  declineMemo,
  deleteDraft,
  disburseMemo,
  disburseSchema,
  memoSchema,
  queryMemo,
  reasonSchema,
  routeSchema,
  saveMemo,
  saveMemoTemplate,
  saveRoute,
  submitMemo,
  templateSchema,
  withdrawMemo,
} from "@/server/services/memos";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/memos");
  if (id) revalidatePath(`/memos/${id}`);
};

export const saveMemoAction = orgAction(
  { perm: "memo.create", schema: memoSchema.extend({ send: z.boolean().optional() }) },
  async ({ send, ...input }, ctx, tx) => {
    const id = await saveMemo(tx, ctx, input);
    const ref = send ? await submitMemo(tx, ctx, id) : null;
    refresh(id);
    return { data: { id, ref }, message: ref ? `Sent as ${ref}` : "Draft saved" };
  },
);

export const submitMemoAction = orgAction({ perm: "memo.create", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const ref = await submitMemo(tx, ctx, id);
  refresh(id);
  return { data: ref, message: `Sent as ${ref}` };
});

export const approveMemoAction = orgAction({ perm: "memo.approve", schema: decisionSchema }, async (input, ctx, tx) => {
  const r = await approveMemo(tx, ctx, input);
  refresh(input.id);
  return { data: r, message: r.final ? "Approved. The memo is cleared." : "Approved. It moves to the next step." };
});

export const declineMemoAction = orgAction({ perm: "memo.approve", schema: reasonSchema }, async (input, ctx, tx) => {
  await declineMemo(tx, ctx, input);
  refresh(input.id);
  return { data: null, message: "Declined" };
});

export const queryMemoAction = orgAction({ perm: "memo.approve", schema: reasonSchema }, async (input, ctx, tx) => {
  await queryMemo(tx, ctx, input);
  refresh(input.id);
  return { data: null, message: "Query sent to the initiator" };
});

export const answerQueryAction = orgAction({ perm: "memo.create", schema: reasonSchema }, async (input, ctx, tx) => {
  await answerQuery(tx, ctx, input);
  refresh(input.id);
  return { data: null, message: "Answered. It's back with the approver." };
});

export const withdrawMemoAction = orgAction({ perm: "memo.create", schema: reasonSchema }, async (input, ctx, tx) => {
  await withdrawMemo(tx, ctx, input);
  refresh(input.id);
  return { data: null, message: "Withdrawn" };
});

export const deleteDraftAction = orgAction({ perm: "memo.create", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await deleteDraft(tx, ctx, id);
  refresh();
  return { data: null, message: "Draft deleted" };
});

export const commentAction = orgAction({ perm: "memo.create", schema: commentSchema }, async (input, ctx, tx) => {
  await addComment(tx, ctx, input);
  refresh(input.id);
  return { data: null };
});

export const disburseAction = orgAction({ perm: "memo.disburse", schema: disburseSchema }, async (input, ctx, tx) => {
  const r = await disburseMemo(tx, ctx, input);
  refresh(input.id);
  revalidatePath("/expenses");
  return { data: r, message: r.expenseId ? "Payment recorded and added to expenses" : "Payment recorded" };
});

export const saveRouteAction = orgAction({ perm: "settings.manage", schema: routeSchema }, async (input, ctx, tx) => {
  await saveRoute(tx, ctx, input);
  revalidatePath("/memos/settings");
  return { data: null, message: "Approval route saved" };
});

export const saveMemoTemplateAction = orgAction({ perm: "settings.manage", schema: templateSchema }, async (input, ctx, tx) => {
  await saveMemoTemplate(tx, ctx, input);
  revalidatePath("/memos/settings");
  return { data: null, message: "Template saved" };
});

export const archiveMemoTemplateAction = orgAction({ perm: "settings.manage", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await archiveMemoTemplate(tx, ctx, id);
  revalidatePath("/memos/settings");
  return { data: null, message: "Template removed" };
});
