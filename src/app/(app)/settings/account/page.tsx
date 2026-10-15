import type { Metadata } from "next";
import QRCode from "qrcode";
import { requireCtx } from "@/server/auth/context";
import { listSessions } from "@/server/services/account";
import { newTotpSecret, otpauthUrl } from "@/server/auth/totp";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { AccountView } from "./view";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireCtx();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.user.id));
  const sessions = await listSessions(ctx.user.id);
  let setup: { secret: string; qr: string } | null = null;
  if (!u!.mfaEnabled) {
    const secret = newTotpSecret();
    setup = { secret, qr: await QRCode.toDataURL(otpauthUrl(secret, u!.email), { margin: 1, width: 200 }) };
  }
  return (
    <AccountView
      user={{
        name: u!.name,
        email: u!.email,
        phone: u!.phone ?? "",
        mfa: u!.mfaEnabled,
        recoveryLeft: u!.mfaRecoveryHashes.length,
      }}
      setup={setup}
      sessions={sessions.map((s) => ({
        current: s.id === ctx.sessionId,
        ua: s.userAgent ?? "Unknown device",
        ip: s.ip ?? "",
        lastSeen: s.lastSeenAt.toISOString(),
      }))}
    />
  );
}
