"use server";
import { redirect } from "next/navigation";
import { getCtx, userOrgs } from "@/server/auth/context";
import { updateSession } from "@/server/auth/session";

export async function switchOrgAction(orgId: string) {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in");
  const orgs = await userOrgs(ctx.user.id);
  if (!orgs.some((o) => o.id === orgId)) return;
  await updateSession({ orgId });
  redirect("/dashboard");
}
