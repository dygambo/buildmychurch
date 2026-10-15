"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction, zodFieldErrors } from "@/server/action";
import { AppError } from "@/server/errors";
import { MEMBER_STATUS, STAGES } from "@/server/db/schema";
import {
  bulkUpdate,
  createMember,
  leaveHousehold,
  linkHousehold,
  memberSchema,
  type MemberInput,
  removeMember,
  searchMembers,
  setMemberTags,
  updateMember,
} from "@/server/services/members";
import { checkImport, commitImport, IMPORT_FIELDS, startImport, undoImport } from "@/server/services/imports";

const uuid = z.string().uuid();
/** The form sends everything as text; turn the checkboxes and blank numbers into proper values first. */
const formInput = z.record(z.string(), z.unknown());

export const saveMemberAction = orgAction(
  {
    perm: "members.write",
    schema: z.object({ id: uuid.optional(), values: formInput, allowDuplicate: z.boolean().optional() }),
  },
  async ({ id, values, allowDuplicate }, ctx, tx) => {
    const parsed = memberSchema.safeParse(values);
    if (!parsed.success) throw new AppError("Check the highlighted fields.", zodFieldErrors(parsed.error));
    const input = values as MemberInput;
    const name = `${parsed.data.firstName} ${parsed.data.lastName}`;
    if (id) {
      await updateMember(tx, ctx, id, input);
      revalidatePath(`/members/${id}`);
      revalidatePath("/members");
      return { data: { id }, message: "Changes saved" };
    }
    const m = await createMember(tx, ctx, input, { allowDuplicate });
    revalidatePath("/members");
    return { data: { id: m.id }, message: `${name} added as ${m.memberNo}` };
  },
);

export const removeMemberAction = orgAction(
  {
    perm: "members.write",
    schema: z.object({ id: uuid, reason: z.string().trim().min(3, "Say why, for the record.") }),
  },
  async ({ id, reason }, ctx, tx) => {
    await removeMember(tx, ctx, id, reason);
    revalidatePath("/members");
    return { data: null, message: "Member removed and their contact details erased" };
  },
);

export const setTagsAction = orgAction(
  { perm: "members.write", schema: z.object({ id: uuid, tags: z.array(z.string().max(40)).max(20) }) },
  async ({ id, tags }, ctx, tx) => {
    await setMemberTags(tx, ctx, id, tags);
    revalidatePath(`/members/${id}`);
    return { data: null, message: "Tags saved" };
  },
);

export const bulkAction = orgAction(
  {
    perm: "members.write",
    schema: z.object({
      ids: z.array(uuid).min(1, "Select at least one person.").max(500),
      stage: z.enum(STAGES).optional(),
      status: z.enum(MEMBER_STATUS).optional(),
      addTag: z.string().trim().max(40).optional(),
      groupId: uuid.optional(),
    }),
  },
  async ({ ids, ...change }, ctx, tx) => {
    const n = await bulkUpdate(tx, ctx, ids, change);
    revalidatePath("/members");
    return { data: n, message: `Updated ${n} ${n === 1 ? "person" : "people"}` };
  },
);

export const findMembersAction = orgAction(
  { perm: "members.read", schema: z.object({ q: z.string().max(80) }) },
  async ({ q }, ctx, tx) =>
    (await searchMembers(tx, ctx, q)).map((m) => ({
      id: m.id,
      name: `${m.firstName} ${m.lastName}`,
      memberNo: m.memberNo,
      inHousehold: !!m.householdId,
    })),
);

const hhRole = z.enum(["head", "spouse", "child", "relative"]);
export const linkFamilyAction = orgAction(
  { perm: "members.write", schema: z.object({ memberId: uuid, otherId: uuid, memberRole: hhRole, otherRole: hhRole }) },
  async (input, ctx, tx) => {
    await linkHousehold(tx, ctx, input);
    revalidatePath(`/members/${input.memberId}`);
    revalidatePath(`/members/${input.otherId}`);
    return { data: null, message: "Family linked" };
  },
);

export const leaveFamilyAction = orgAction(
  { perm: "members.write", schema: z.object({ memberId: uuid, from: uuid }) },
  async ({ memberId, from }, ctx, tx) => {
    await leaveHousehold(tx, ctx, memberId);
    revalidatePath(`/members/${from}`);
    return { data: null, message: "Removed from the family" };
  },
);

/* ---------- import ---------- */

const mapping = z.record(z.string(), z.enum([...(Object.keys(IMPORT_FIELDS) as [keyof typeof IMPORT_FIELDS]), ""]));

export const startImportAction = orgAction(
  { perm: "members.import", schema: z.instanceof(FormData) },
  async (fd, ctx, tx) => {
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return startImportFail("Choose a file to upload.");
    if (file.size > 10 * 1024 * 1024) return startImportFail("That file is over 10 MB. Split it into smaller files.");
    return startImport(tx, ctx, { name: file.name, data: await file.arrayBuffer() });
  },
);
function startImportFail(msg: string): never {
  throw new AppError(msg);
}

export const checkImportAction = orgAction(
  { perm: "members.import", schema: z.object({ jobId: uuid, mapping }) },
  async ({ jobId, mapping }, ctx, tx) => checkImport(tx, ctx, jobId, mapping),
);

export const commitImportAction = orgAction(
  { perm: "members.import", schema: z.object({ jobId: uuid, mapping }) },
  async ({ jobId, mapping }, ctx, tx) => {
    const r = await commitImport(tx, ctx, jobId, mapping);
    revalidatePath("/members");
    return { data: r, message: `${r.added} member${r.added === 1 ? "" : "s"} imported` };
  },
);

export const undoImportAction = orgAction(
  { perm: "members.import", schema: z.object({ jobId: uuid }) },
  async ({ jobId }, ctx, tx) => {
    const n = await undoImport(tx, ctx, jobId);
    revalidatePath("/members");
    revalidatePath("/members/import");
    return { data: n, message: `Import undone. ${n} member${n === 1 ? "" : "s"} removed.` };
  },
);
