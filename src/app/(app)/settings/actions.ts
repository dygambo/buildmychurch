"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction, type ActionResult } from "@/server/action";
import { getCtx } from "@/server/auth/context";
import { inviteStaff, revokeInvite, saveRole, updateMembership, updateOrg } from "@/server/services/org";
import { changePassword, updateProfile } from "@/server/services/account";
import { addTeamMember, addTeamSchema, removeTeamMember, removeTeamSchema, resetTeamPassword, setTeamStatus, teamCandidate } from "@/server/services/team";
import { disableMfa, enableMfa } from "@/server/services/accounts";
import { verifyPassword } from "@/server/auth/password";
import { db, withOrg } from "@/server/db";
import { removeBrandImage, setAccent, uploadBrandImage } from "@/server/services/brand";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "@/server/errors";

const opt = z.string().trim().optional();

export const updateOrgAction = orgAction(
  {
    perm: "settings.manage",
    schema: z.object({
      name: z.string().trim().min(3, "Enter the church name."),
      denomination: opt,
      state: opt,
      lga: opt,
      address: opt,
      phone: opt,
      email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]).optional(),
      smsSenderId: opt,
    }),
  },
  async (input, ctx, tx) => {
    await updateOrg(tx, ctx, input);
    revalidatePath("/", "layout");
    return { data: null, message: "Church profile saved" };
  },
);

export const inviteAction = orgAction(
  {
    perm: "users.manage",
    schema: z.object({
      email: z.string().trim().email("Enter a valid email."),
      name: z.string().trim().min(2, "Enter their name."),
      roleId: z.string().uuid("Choose a role."),
      branchIds: z.array(z.string().uuid()).default([]),
      title: opt,
    }),
  },
  async (input, ctx, tx) => {
    await inviteStaff(tx, ctx, input);
    revalidatePath("/settings/team");
    return { data: null, message: `Invitation sent to ${input.email}` };
  },
);

export const revokeInviteAction = orgAction(
  { perm: "users.manage", schema: z.object({ id: z.string().uuid() }) },
  async ({ id }, ctx, tx) => {
    await revokeInvite(tx, ctx, id);
    revalidatePath("/settings/team");
    return { data: null, message: "Invitation cancelled" };
  },
);

export const updateMemberAction = orgAction(
  {
    perm: "users.manage",
    schema: z.object({
      membershipId: z.string().uuid(),
      roleId: z.string().uuid(),
      branchIds: z.array(z.string().uuid()).default([]),
      status: z.enum(["active", "disabled"]),
      title: opt,
      staffId: opt,
    }),
  },
  async (input, ctx, tx) => {
    await updateMembership(tx, ctx, input);
    revalidatePath("/settings/team");
    return { data: null, message: "Team member updated" };
  },
);

export const saveRoleAction = orgAction(
  {
    perm: "users.manage",
    schema: z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2, "Give the role a name."),
      description: opt,
      permissions: z.array(z.string()).default([]),
    }),
  },
  async (input, ctx, tx) => {
    await saveRole(tx, ctx, input);
    revalidatePath("/settings/roles");
    return { data: null, message: "Role saved" };
  },
);

async function me() {
  const ctx = await getCtx();
  if (!ctx) throw new AppError("Your session has ended. Sign in again.");
  return ctx;
}
function wrap<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  return fn().catch((e) => {
    if (e instanceof AppError) return { ok: false as const, error: e.message, fieldErrors: e.fieldErrors };
    console.error(e);
    return { ok: false as const, error: "Something went wrong and nothing was saved. Try again." };
  });
}

export async function updateProfileAction(input: { name: string; phone?: string }) {
  return wrap(async () => {
    const ctx = await me();
    if (!input.name?.trim()) throw new AppError("Enter your name.", { name: "Enter your name." });
    await updateProfile(ctx.user.id, input);
    revalidatePath("/", "layout");
    return { ok: true, data: null, message: "Profile saved" };
  });
}

export async function changePasswordAction(input: { current: string; next: string }) {
  return wrap(async () => {
    const ctx = await me();
    await changePassword(ctx.user.id, input.current, input.next);
    return { ok: true, data: null, message: "Password changed" };
  });
}

export async function enableMfaAction(input: { secret: string; code: string }) {
  return wrap(async () => {
    const ctx = await me();
    const codes = await enableMfa(ctx.user.id, input.secret, input.code);
    revalidatePath("/settings/account");
    return { ok: true, data: { codes }, message: "Two-step verification is on" };
  });
}

export async function disableMfaAction(input: { password: string }) {
  return wrap(async () => {
    const ctx = await me();
    const [u] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    if (!u || !(await verifyPassword(u.passwordHash, input.password)))
      throw new AppError("That password isn't right.", { password: "Wrong password." });
    await disableMfa(ctx.user.id);
    revalidatePath("/settings/account");
    return { ok: true, data: null, message: "Two-step verification is off" };
  });
}

/* ---------- team accounts from the members directory ---------- */

const membershipIdSchema = z.object({ membershipId: z.string().uuid() });

export const teamCandidateAction = orgAction({ perm: "users.manage", schema: z.object({ memberId: z.string().uuid() }) }, async ({ memberId }, ctx, tx) => {
  return { data: await teamCandidate(tx, ctx, memberId) };
});

export const addTeamMemberAction = orgAction({ perm: "users.manage", schema: addTeamSchema }, async (input, ctx, tx) => {
  const r = await addTeamMember(tx, ctx, input);
  revalidatePath("/settings/team");
  return {
    data: r,
    message: r.newAccount ? `${r.name} is on the team. Their sign-in details are on the way to ${input.email}.` : `${r.name} is on the team. They can sign in with their existing password.`,
  };
});

export const resetTeamPasswordAction = orgAction({ perm: "users.manage", schema: membershipIdSchema }, async ({ membershipId }, ctx, tx) => {
  const r = await resetTeamPassword(tx, ctx, membershipId);
  revalidatePath("/settings/team");
  return {
    data: r,
    message: r.mode === "temporary" ? `New temporary password emailed to ${r.email}. They've been signed out.` : `They also work with another church, so we emailed ${r.email} a link to choose a new password.`,
  };
});

export const setTeamStatusAction = orgAction(
  { perm: "users.manage", schema: membershipIdSchema.extend({ status: z.enum(["active", "disabled"]) }) },
  async (input, ctx, tx) => {
    await setTeamStatus(tx, ctx, input);
    revalidatePath("/settings/team");
    return { data: null, message: input.status === "disabled" ? "Access suspended" : "Access restored" };
  },
);

export const removeTeamMemberAction = orgAction({ perm: "users.manage", schema: removeTeamSchema }, async (input, ctx, tx) => {
  const r = await removeTeamMember(tx, ctx, input);
  revalidatePath("/settings/team");
  revalidatePath("/members");
  return { data: r, message: `${r.name} was removed from the team${r.removedMember ? " and the members directory" : ". Their member record is unchanged"}.` };
});

/* ---------- branding ---------- */

export async function uploadBrandAction(form: FormData): Promise<ActionResult<null>> {
  const ctx = await getCtx();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again to continue." };
  if (!ctx.can("settings.manage")) return { ok: false, error: "Your role doesn't allow this. Ask a Super Admin if you need access." };
  const kind = form.get("kind");
  const file = form.get("file");
  if ((kind !== "logo" && kind !== "favicon") || !(file instanceof File)) return { ok: false, error: "Choose an image to upload." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await withOrg(ctx.org.id, (tx) => uploadBrandImage(tx, ctx, { kind, name: file.name, bytes }));
    revalidatePath("/", "layout");
    return { ok: true, data: null, message: kind === "logo" ? "Logo saved. It now appears on emails and PDFs." : "Browser icon saved" };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[brand]", e);
    return { ok: false, error: "Something went wrong on our side, and nothing was saved. Try again in a moment." };
  }
}

export const removeBrandAction = orgAction({ perm: "settings.manage", schema: z.object({ kind: z.enum(["logo", "favicon"]) }) }, async ({ kind }, ctx, tx) => {
  await removeBrandImage(tx, ctx, kind);
  revalidatePath("/", "layout");
  return { data: null, message: kind === "logo" ? "Logo removed" : "Browser icon removed" };
});

export const setAccentAction = orgAction(
  { perm: "settings.manage", schema: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour.").nullable() }) },
  async ({ accent }, ctx, tx) => {
    await setAccent(tx, ctx, accent);
    revalidatePath("/", "layout");
    return { data: null, message: accent ? "App colour saved for everyone in your church" : "Back to the default colour" };
  },
);
