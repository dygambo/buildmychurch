import { eq } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { AppError } from "../errors";
import { normalizeNgPhone } from "@/lib/phone";

export async function updateProfile(userId: string, input: { name: string; phone?: string }) {
  const phone = input.phone ? normalizeNgPhone(input.phone) : null;
  if (input.phone && !phone)
    throw new AppError("Enter a valid Nigerian phone number.", { phone: "Enter a valid phone number." });
  await db.update(users).set({ name: input.name.trim(), phone }).where(eq(users.id, userId));
}

export async function changePassword(userId: string, current: string, next: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(u.passwordHash, current)))
    throw new AppError("Your current password isn't right.", { current: "Wrong password." });
  const problem = passwordProblem(next, { email: u.email });
  if (problem) throw new AppError(problem, { next: problem });
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, userId));
}

export async function listSessions(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}
