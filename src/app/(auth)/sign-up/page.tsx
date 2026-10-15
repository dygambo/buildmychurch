import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./form";

export const metadata: Metadata = { title: "Create your church account" };

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Set up your church</h1>
        <p className="mt-1 text-muted">Free for churches under 100 members. No card needed.</p>
      </div>
      <SignUpForm />
      <p className="text-center text-[13px] text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
