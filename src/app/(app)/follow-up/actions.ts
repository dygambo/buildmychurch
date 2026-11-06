"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import { FOLLOWUP_STAGES } from "@/server/db/schema";
import {
  addNote,
  assignFollowup,
  getFollowup,
  moveFollowup,
  rotateVisitorLink,
  startFollowup,
} from "@/server/services/followup";

const uuid = z.string().uuid();

export const loadFollowupAction = orgAction(
  { perm: "followup.manage", schema: z.object({ id: uuid }) },
  async ({ id }, ctx, tx) => {
    const f = await getFollowup(tx, ctx, id);
    return {
      ...f,
      dueAt: f.dueAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
      notes: f.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    };
  },
);

export const addNoteAction = orgAction(
  {
    perm: "followup.manage",
    schema: z.object({
      id: uuid,
      method: z.enum(["call", "sms", "whatsapp", "visit", "email", "in_person", "note"]),
      outcome: z.enum(["reached", "no_answer", "wrong_number", "callback", "done"]).optional().or(z.literal("")),
      body: z.string().trim().max(2000).optional(),
      nextDueDays: z.coerce.number().int().min(0).max(90).optional(),
    }),
  },
  async ({ id, outcome, ...rest }, ctx, tx) => {
    await addNote(tx, ctx, id, { ...rest, outcome: outcome || null, nextDueDays: rest.nextDueDays || null });
    revalidatePath("/follow-up");
    return { data: null, message: "Saved" };
  },
);

export const moveFollowupAction = orgAction(
  {
    perm: "followup.manage",
    schema: z.object({ id: uuid, stage: z.enum(FOLLOWUP_STAGES), closedReason: z.string().trim().max(300).optional() }),
  },
  async ({ id, stage, closedReason }, ctx, tx) => {
    await moveFollowup(tx, ctx, id, stage, closedReason);
    revalidatePath("/follow-up");
    return { data: null, message: stage === "integrated" ? "Marked as integrated. They're now a regular." : "Moved" };
  },
);

export const assignFollowupAction = orgAction(
  { perm: "followup.manage", schema: z.object({ id: uuid, userId: uuid.or(z.literal("")) }) },
  async ({ id, userId }, ctx, tx) => {
    await assignFollowup(tx, ctx, id, userId || null);
    revalidatePath("/follow-up");
    return { data: null, message: userId ? "Assigned" : "Unassigned" };
  },
);

export const startFollowupAction = orgAction(
  {
    perm: "followup.manage",
    schema: z.object({ memberId: uuid, reason: z.enum(["first_timer", "absentee", "new_convert", "other"]) }),
  },
  async ({ memberId, reason }, ctx, tx) => {
    const r = await startFollowup(tx, ctx, memberId, reason);
    revalidatePath("/follow-up");
    revalidatePath(`/members/${memberId}`);
    return { data: r, message: r.created ? "Follow-up started" : "They already have open follow-up" };
  },
);

export const rotateVisitorLinkAction = orgAction(
  { perm: "followup.manage", schema: z.object({}) },
  async (_i, ctx, tx) => {
    await rotateVisitorLink(tx, ctx);
    revalidatePath("/follow-up");
    return { data: null, message: "New QR code ready. Replace any printed copies." };
  },
);
