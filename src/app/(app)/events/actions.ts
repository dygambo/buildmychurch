"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  cancelRegistration,
  checkInTicket,
  checkinSchema,
  deskSchema,
  eventSchema,
  registerAtDesk,
  saveEvent,
  setEventStatus,
} from "@/server/services/events";

const uuid = z.string().uuid();

export const saveEventAction = orgAction({ perm: "events.manage", schema: eventSchema }, async (input, ctx, tx) => {
  const id = await saveEvent(tx, ctx, input);
  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  return { data: { id }, message: input.id ? "Event updated" : "Event created as a draft" };
});

export const eventStatusAction = orgAction(
  { perm: "events.manage", schema: z.object({ id: uuid, status: z.enum(["published", "cancelled", "draft"]) }) },
  async ({ id, status }, ctx, tx) => {
    await setEventStatus(tx, ctx, id, status);
    revalidatePath(`/events/${id}`);
    revalidatePath("/events");
    return { data: null, message: status === "published" ? "Registration is open" : status === "cancelled" ? "Event cancelled. Registered people are emailed." : "Moved back to draft" };
  },
);

export const checkInAction = orgAction({ perm: "events.manage", schema: checkinSchema }, async (input, ctx, tx) => {
  const r = await checkInTicket(tx, ctx, input);
  revalidatePath(`/events/${input.eventId}/checkin`);
  return { data: r };
});

export const deskAction = orgAction({ perm: "events.manage", schema: deskSchema }, async (input, ctx, tx) => {
  const code = await registerAtDesk(tx, ctx, input);
  revalidatePath(`/events/${input.eventId}`);
  return { data: { code }, message: `${input.name} registered${input.checkIn ? " and checked in" : ""}` };
});

export const cancelRegistrationAction = orgAction({ perm: "events.manage", schema: z.object({ id: uuid, eventId: uuid }) }, async ({ id, eventId }, ctx, tx) => {
  await cancelRegistration(tx, ctx, id);
  revalidatePath(`/events/${eventId}`);
  return { data: null, message: "Registration cancelled" };
});
