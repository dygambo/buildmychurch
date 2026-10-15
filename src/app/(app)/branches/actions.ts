"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import { archiveBranch, saveBranch } from "@/server/services/org";

const opt = z.string().trim().optional();
export const saveBranchAction = orgAction(
  {
    perm: "branches.manage",
    schema: z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2, "Enter the branch name."),
      code: z.string().trim().min(2, "Enter a short code."),
      parentId: z.string().uuid().optional().or(z.literal("")),
      address: opt,
      phone: opt,
      pastorName: opt,
    }),
  },
  async (input, ctx, tx) => {
    await saveBranch(tx, ctx, { ...input, parentId: input.parentId || null });
    revalidatePath("/branches");
    return { data: null, message: input.id ? "Branch saved" : `${input.name} added` };
  },
);
export const archiveBranchAction = orgAction(
  { perm: "branches.manage", schema: z.object({ id: z.string().uuid(), archived: z.boolean() }) },
  async (i, ctx, tx) => {
    await archiveBranch(tx, ctx, i.id, i.archived);
    revalidatePath("/branches");
    return { data: null, message: i.archived ? "Branch archived" : "Branch restored" };
  },
);
