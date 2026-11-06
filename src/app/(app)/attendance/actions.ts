"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import {
  archiveTemplate,
  checkIn,
  createService,
  lagosToday,
  recordHeadcount,
  saveTemplate,
  setServiceStatus,
  startFromTemplates,
  undoCheckIn,
} from "@/server/services/attendance";
import { SERVICE_KINDS } from "@/server/db/schema";

const uuid = z.string().uuid();
const time = z.string().regex(/^\d{2}:\d{2}$/, "Enter a time.");
const count = z.coerce.number().int().min(0, "Can't be negative.").max(1_000_000);

export const saveTemplateAction = orgAction(
  {
    perm: "attendance.record",
    schema: z.object({
      id: uuid.optional(),
      branchId: uuid,
      name: z.string().trim().min(2, "Enter a name.").max(80),
      kind: z.enum(SERVICE_KINDS),
      weekday: z.coerce.number().int().min(0).max(6),
      startTime: time,
      durationMin: z.coerce
        .number()
        .int()
        .min(15)
        .max(24 * 60),
    }),
  },
  async (input, ctx, tx) => {
    await saveTemplate(tx, ctx, input);
    revalidatePath("/attendance");
    return { data: null, message: "Regular service saved" };
  },
);

export const archiveTemplateAction = orgAction(
  { perm: "attendance.record", schema: z.object({ id: uuid }) },
  async ({ id }, ctx, tx) => {
    await archiveTemplate(tx, ctx, id);
    revalidatePath("/attendance");
    return { data: null, message: "Removed" };
  },
);

export const createServiceAction = orgAction(
  {
    perm: "attendance.record",
    schema: z.object({
      branchId: uuid,
      name: z.string().trim().min(2, "Enter a name.").max(80),
      kind: z.enum(SERVICE_KINDS),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
      startTime: time,
      durationMin: z.coerce
        .number()
        .int()
        .min(15)
        .max(24 * 60),
    }),
  },
  async (input, ctx, tx) => {
    const id = await createService(tx, ctx, input);
    revalidatePath("/attendance");
    return { data: { id }, message: `${input.name} created` };
  },
);

export const startTodayAction = orgAction({ perm: "attendance.record", schema: z.object({}) }, async (_i, ctx, tx) => {
  const ids = await startFromTemplates(tx, ctx, lagosToday());
  revalidatePath("/attendance");
  return {
    data: ids,
    message: ids.length
      ? `${ids.length} service${ids.length === 1 ? "" : "s"} ready for check-in`
      : "No regular services today",
  };
});

export const checkInMemberAction = orgAction(
  { perm: "attendance.record", schema: z.object({ serviceId: uuid, memberId: uuid }) },
  async ({ serviceId, memberId }, ctx, tx) => {
    const r = await checkIn(tx, ctx, serviceId, memberId, "staff");
    revalidatePath(`/attendance/${serviceId}`);
    return { data: r, message: r.already ? `${r.firstName} was already checked in` : `${r.firstName} checked in` };
  },
);

export const undoCheckInAction = orgAction(
  { perm: "attendance.record", schema: z.object({ serviceId: uuid, memberId: uuid }) },
  async ({ serviceId, memberId }, ctx, tx) => {
    await undoCheckIn(tx, ctx, serviceId, memberId);
    revalidatePath(`/attendance/${serviceId}`);
    return { data: null, message: "Removed from this service" };
  },
);

export const headcountAction = orgAction(
  {
    perm: "attendance.record",
    schema: z.object({
      serviceId: uuid,
      men: count,
      women: count,
      children: count,
      online: count.optional(),
      firstTimersCount: count.optional(),
      countNotes: z.string().trim().max(500).optional(),
    }),
  },
  async ({ serviceId, ...c }, ctx, tx) => {
    await recordHeadcount(tx, ctx, serviceId, c);
    revalidatePath(`/attendance/${serviceId}`);
    revalidatePath("/attendance");
    return { data: null, message: "Headcount saved" };
  },
);

export const serviceStatusAction = orgAction(
  { perm: "attendance.record", schema: z.object({ serviceId: uuid, status: z.enum(["open", "closed"]) }) },
  async ({ serviceId, status }, ctx, tx) => {
    await setServiceStatus(tx, ctx, serviceId, status);
    revalidatePath(`/attendance/${serviceId}`);
    return { data: null, message: status === "closed" ? "Service closed" : "Service reopened" };
  },
);
