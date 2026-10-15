import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="mt-1 text-muted">Enter your email and we'll send you a link to choose a new password.</p>
      </div>
      <ForgotForm />
      <p className="text-center text-[13px]">
        <Link href="/sign-in" className="text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
