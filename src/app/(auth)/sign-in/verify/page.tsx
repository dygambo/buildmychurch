import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/server/auth/session";
import { VerifyForm } from "./form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function VerifyPage() {
  const s = await readSession();
  if (!s) redirect("/sign-in");
  if (!s.mfaPending) redirect("/dashboard");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Two-step verification</h1>
        <p className="mt-1 text-muted">
          Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes.
        </p>
      </div>
      <VerifyForm />
    </div>
  );
}
