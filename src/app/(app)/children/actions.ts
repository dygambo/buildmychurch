"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction, zodFieldErrors } from "@/server/action";
import { AppError } from "@/server/errors";
import {
  archiveChild,
  cancelCheckIn,
  checkInChild,
  checkOutChild,
  childIdByQr,
  childSchema,
  getChild,
  listChildren,
  registerChild,
  rotateQr,
  updateChild,
  verifyChain,
  type ChildInput,
} from "@/server/services/children";

const uuid = z.string().uuid();

function parseChild(values: unknown) {
  const r = childSchema.safeParse(values);
  if (!r.success) throw new AppError("Check the highlighted fields.", zodFieldErrors(r.error));
  return values as ChildInput;
}

export const saveChildAction = orgAction(
  { perm: "children.manage", schema: z.object({ id: uuid.optional(), values: z.record(z.string(), z.unknown()) }) },
  async ({ id, values }, ctx, tx) => {
    const input = parseChild(values);
    if (id) {
      await updateChild(tx, ctx, id, input);
      revalidatePath(`/children/${id}`);
      return { data: { id }, message: "Saved" };
    }
    const r = await registerChild(tx, ctx, input);
    revalidatePath("/children");
    return { data: { id: r.id }, message: `${input.firstName} registered as ${r.childNo}` };
  },
);

export const rotateQrAction = orgAction(
  { perm: "children.manage", schema: z.object({ id: uuid }) },
  async ({ id }, ctx, tx) => {
    await rotateQr(tx, ctx, id);
    revalidatePath(`/children/${id}`);
    return { data: null, message: "New QR tag ready. Print it and destroy the old one." };
  },
);

export const setChildStatusAction = orgAction(
  { perm: "children.manage", schema: z.object({ id: uuid, status: z.enum(["active", "graduated", "inactive"]) }) },
  async ({ id, status }, ctx, tx) => {
    await archiveChild(tx, ctx, id, status);
    revalidatePath(`/children/${id}`);
    revalidatePath("/children");
    return { data: null, message: "Status updated" };
  },
);

/** For the desk: find a child from a scanned tag or a search result. */
export const deskLookupAction = orgAction(
  { perm: "children.checkin", schema: z.object({ qr: z.string().max(200).optional(), childId: uuid.optional() }) },
  async ({ qr, childId }, ctx, tx) => {
    const id = childId ?? (qr ? await childIdByQr(tx, qr) : null);
    if (!id)
      throw new AppError("That QR code isn't a current child tag. It may have been replaced; search by name instead.");
    const c = await getChild(tx, ctx, id);
    return {
      id: c.id,
      childNo: c.childNo,
      name: `${c.firstName} ${c.lastName}`,
      firstName: c.firstName,
      age: c.age,
      classGroup: c.effectiveClass,
      status: c.status,
      hasMedical: c.hasMedical,
      allergies: c.allergies,
      medical: c.medical,
      specialNeeds: c.specialNeeds,
      open: c.open
        ? {
            checkedInAt: c.open.checkedInAt.toISOString(),
            securityCode: c.open.securityCode,
            classGroup: c.open.classGroup,
            // mistakes can be undone for 10 minutes
            canCancel: Date.now() - c.open.checkedInAt.getTime() < 10 * 60_000,
          }
        : null,
      guardians: c.guardians.map((g) => ({
        id: g.id,
        name: `${g.title ? g.title + " " : ""}${g.firstName} ${g.lastName}`,
        relationship: g.relationship,
        canPickUp: g.canPickUp,
        isPrimary: g.isPrimary,
        phone: g.phone,
        hasEmail: !!g.email && g.notify,
      })),
    };
  },
);

export const deskSearchAction = orgAction(
  { perm: "children.checkin", schema: z.object({ q: z.string().max(80) }) },
  async ({ q }, ctx, tx) =>
    q.trim().length < 2
      ? []
      : (await listChildren(tx, ctx, { q })).slice(0, 8).map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`,
          classGroup: c.classGroup,
          here: c.here,
          parent: c.guardians[0] ? `${c.guardians[0].firstName} ${c.guardians[0].lastName}` : "",
        })),
);

export const checkInAction = orgAction(
  {
    perm: "children.checkin",
    schema: z.object({
      childId: uuid,
      droppedOffBy: uuid,
      method: z.enum(["qr", "manual"]),
      serviceId: uuid.optional(),
    }),
  },
  async (input, ctx, tx) => {
    const r = await checkInChild(tx, ctx, input);
    revalidatePath("/children/desk");
    return { data: r, message: `${r.childName} checked in. Parents are being emailed.` };
  },
);

export const checkOutAction = orgAction(
  {
    perm: "children.checkin",
    schema: z.object({
      childId: uuid,
      pickedUpBy: uuid,
      method: z.enum(["qr", "manual", "code"]),
      securityCode: z.string().trim().max(8).optional(),
      overrideReason: z.string().trim().max(300).optional(),
    }),
  },
  async (input, ctx, tx) => {
    const r = await checkOutChild(tx, ctx, input);
    revalidatePath("/children/desk");
    return { data: r, message: `${r.childName} released to ${r.guardianName}. Parents are being emailed.` };
  },
);

export const cancelCheckInAction = orgAction(
  { perm: "children.checkin", schema: z.object({ childId: uuid }) },
  async ({ childId }, ctx, tx) => {
    await cancelCheckIn(tx, ctx, childId);
    revalidatePath("/children/desk");
    return { data: null, message: "Check-in cancelled" };
  },
);

export const verifyChainAction = orgAction({ perm: "children.manage", schema: z.object({}) }, async (_i, ctx, tx) => {
  const r = await verifyChain(tx, ctx);
  return { ...r, brokenOn: "brokenOn" in r && r.brokenOn ? r.brokenOn.toISOString() : null };
});
