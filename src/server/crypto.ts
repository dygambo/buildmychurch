import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const key = (b64: string) => {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("Encryption keys must be exactly 32 bytes (base64-encoded)");
  return k;
};

/** AES-256-GCM. Output: "v1." + base64url(iv | tag | ciphertext). */
export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env().ENCRYPTION_KEY), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1." + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(token: string | null | undefined): string | null {
  if (!token) return null;
  if (!token.startsWith("v1.")) throw new Error("Unknown ciphertext version");
  const raw = Buffer.from(token.slice(3), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(env().ENCRYPTION_KEY), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Keyed blind index for equality lookups on encrypted values (duplicates, sign-in by phone). */
export function blindIndex(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHmac("sha256", key(env().BLIND_INDEX_KEY)).update(value.trim().toLowerCase()).digest("hex").slice(0, 40);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
