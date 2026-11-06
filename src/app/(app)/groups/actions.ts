"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import { addToGroup, archiveGroup, removeFromGroup, saveGroup, setGroupRole } from "@/server/services/groups";

const uuid = z.string().uuid();
const opt = z.string().trim().max(120).optional();
const role = z.enum(["leader", "assistant", "member"]);

export const saveGroupAction = orgAction(
  {
    perm: "groups.manage",
    schema: z.object({
      id: uuid.optional(),
      kind: z.enum(["department", "cell", "ministry"]),
      name: z.string().trim().min(2, "Enter a name.").max(80),
      branchId: uuid,
      description: z.string().trim().max(500).optional(),
      meetingDay: opt,
      meetingTime: opt,
      location: opt,
      area: opt,
    }),
  },
  async (input, ctx, tx) => {
    const id = await saveGroup(tx, ctx, input);
    revalidatePath("/groups");
    revalidatePath(`/groups/${id}`);
    return { data: { id }, message: input.id ? "Saved" : `${input.name} added` };
  },
);

export const archiveGroupAction = orgAction(
  { perm: "groups.manage", schema: z.object({ id: uuid, archived: z.boolean() }) },
  async ({ id, archived }, ctx, tx) => {
    await archiveGroup(tx, ctx, id, archived);
    revalidatePath("/groups");
    revalidatePath(`/groups/${id}`);
    return { data: null, message: archived ? "Archived" : "Restored" };
  },
);

export const addToGroupAction = orgAction(
  {
    perm: "groups.manage",
    schema: z.object({ groupId: uuid, memberIds: z.array(uuid).min(1).max(200), role: role.optional() }),
  },
  async ({ groupId, memberIds, role }, ctx, tx) => {
    const n = await addToGroup(tx, ctx, groupId, memberIds, role);
    revalidatePath(`/groups/${groupId}`);
    return { data: n, message: n ? `Added ${n} ${n === 1 ? "person" : "people"}` : "Already in this group" };
  },
);

export const removeFromGroupAction = orgAction(
  { perm: "groups.manage", schema: z.object({ groupId: uuid, memberId: uuid }) },
  async ({ groupId, memberId }, ctx, tx) => {
    await removeFromGroup(tx, ctx, groupId, memberId);
    revalidatePath(`/groups/${groupId}`);
    return { data: null, message: "Removed from the group" };
  },
);

export const setGroupRoleAction = orgAction(
  { perm: "groups.manage", schema: z.object({ groupId: uuid, memberId: uuid, role }) },
  async ({ groupId, memberId, role }, ctx, tx) => {
    await setGroupRole(tx, ctx, groupId, memberId, role);
    revalidatePath(`/groups/${groupId}`);
    return { data: null, message: "Role updated" };
  },
);
