import type { Metadata } from "next";
import { ResetForm } from "./form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        <p className="mt-1 text-muted">Signing in again will end your other sessions for safety.</p>
      </div>
      <ResetForm token={token} />
    </div>
  );
}
