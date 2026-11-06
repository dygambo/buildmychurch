import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { readSession } from "@/server/auth/session";
import { firstName } from "@/lib/format";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Choose your password" };

export default async function ChangePasswordPage() {
  const s = await readSession();
  if (!s || s.mfaPending) redirect("/sign-in");
  const [u] = await db.select({ name: users.name, must: users.mustChangePassword }).from(users).where(eq(users.id, s.userId));
  if (!u?.must) redirect("/dashboard");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {firstName(u.name)}</h1>
        <p className="mt-1 text-muted">You signed in with a temporary password. Choose your own to continue. Only you will know it.</p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
