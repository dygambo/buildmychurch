import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_ADMIN_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_PREPARE: z.enum(["true", "false"]).default("true"),
  ENCRYPTION_KEY: z.string().min(40, "ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
  BLIND_INDEX_KEY: z.string().min(40, "BLIND_INDEX_KEY must be 32 bytes, base64-encoded"),
  EMAIL_PROVIDER: z.enum(["log", "resend", "smtp"]).default("log"),
  EMAIL_FROM: z.string().default("Build My Church <no-reply@buildmychurch.com>"),
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMS_PROVIDER: z.enum(["log", "termii"]).default("log"),
  TERMII_API_KEY: z.string().optional(),
  TERMII_SENDER_ID: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Validated environment. Read lazily so `next build` works without secrets present. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
