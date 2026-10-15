import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);
export async function verifyPassword(hashStr: string, pw: string) {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}

/** Plain-language password rules. Returns a message, or null when the password is acceptable. */
export function passwordProblem(pw: string, ctx: { email?: string; name?: string } = {}): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Use 200 characters or fewer.";
  const lower = pw.toLowerCase();
  if (["password", "1234567890", "qwertyuiop", "buildmychurch"].some((w) => lower.includes(w)))
    return "That password is too easy to guess.";
  if (ctx.email && lower.includes(ctx.email.split("@")[0]!.toLowerCase())) return "Don't include your email address.";
  if (new Set(pw).size < 5) return "Use a mix of different characters.";
  return null;
}
