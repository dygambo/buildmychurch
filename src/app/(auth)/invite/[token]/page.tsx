import type { Metadata } from "next";
import Link from "next/link";
import { readInvite } from "@/server/services/accounts";
import { InviteForm } from "./form";

export const metadata: Metadata = { title: "Join your church team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await readInvite(token);
  if (!inv)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">This invitation can't be used</h1>
        <p className="text-muted">It has expired or was already accepted. Ask your church admin to send a new one.</p>
        <Link href="/sign-in" className="text-accent hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Join {inv.orgName}</h1>
        <p className="mt-1 text-muted">
          {inv.data.invitedBy} invited you ({inv.email}) to the church team on Build My Church.
          {inv.hasAccount ? " Enter your existing password to accept." : " Choose a password to finish setting up."}
        </p>
      </div>
      <InviteForm token={token} name={inv.data.name} hasAccount={inv.hasAccount} />
    </div>
  );
}
