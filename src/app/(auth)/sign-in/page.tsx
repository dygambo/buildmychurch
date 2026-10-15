import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-muted">Welcome back. Sign in to manage your church.</p>
      </div>
      <SignInForm />
      <p className="text-center text-[13px] text-muted">
        New church?{" "}
        <Link href="/sign-up" className="font-medium text-accent hover:underline">
          Create a free account
        </Link>
      </p>
    </div>
  );
}
