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
  TERMII_BASE_URL: z.string().url().default("https://v3.api.termii.com"),
  TERMII_WEBHOOK_SECRET: z.string().optional(),
  WHATSAPP_PROVIDER: z.enum(["none", "log", "meta"]).default("none"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  /** Name of the approved WhatsApp template with one body variable ({{1}}) that carries the message. */
  WHATSAPP_TEMPLATE: z.string().default("church_announcement"),
  /** What one SMS unit costs a church, in kobo. */
  SMS_UNIT_PRICE_KOBO: z.coerce.number().int().positive().default(400),
  /** "fake" runs a built-in checkout page instead of Paystack. Refused in production unless test hooks are on. */
  PAYMENTS_PROVIDER: z.enum(["fake", "paystack"]).default("fake"),
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
