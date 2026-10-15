import { eq, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "../db";
import { sessions } from "../db/schema";
import { randomToken, sha256 } from "../crypto";

export const SESSION_COOKIE = "bmc_session";
const DAY = 86_400_000;
const LIFETIME = 30 * DAY;
const RENEW_WITHIN = 15 * DAY;

async function clientInfo() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function createSession(userId: string, opts: { orgId?: string | null; mfaPending?: boolean } = {}) {
  const token = randomToken(32);
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + LIFETIME);
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    orgId: opts.orgId ?? null,
    mfaPending: !!opts.mfaPending,
    expiresAt,
    ip,
    userAgent,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

/** Returns the session row for the current cookie, sliding its expiry when it's halfway through. */
export async function readSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const [s] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (s.expiresAt.getTime() - Date.now() < RENEW_WITHIN || Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) {
    const expiresAt = s.expiresAt.getTime() - Date.now() < RENEW_WITHIN ? new Date(Date.now() + LIFETIME) : s.expiresAt;
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
    s.expiresAt = expiresAt;
  }
  return s;
}

export async function updateSession(patch: Partial<{ orgId: string | null; mfaPending: boolean }>) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db
    .update(sessions)
    .set(patch)
    .where(eq(sessions.id, sha256(token)));
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function destroyOtherSessions(userId: string, keepToken?: string) {
  const keep = keepToken ? sha256(keepToken) : null;
  const all = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.id !== keep) await db.delete(sessions).where(eq(sessions.id, s.id));
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
