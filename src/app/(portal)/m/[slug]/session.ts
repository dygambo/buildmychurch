import { redirect } from "next/navigation";
import { portalChurch, portalMember } from "@/server/services/portal";

/** The church and signed-in member for a portal page, or a redirect to sign in. */
export async function requireMember(slug: string) {
  const church = await portalChurch(slug);
  if (!church) redirect("/");
  const me = await portalMember(church);
  if (!me) redirect(`/m/${slug}/sign-in`);
  return { church, me };
}
