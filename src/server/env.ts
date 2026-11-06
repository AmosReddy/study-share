import "server-only";
import { z } from "zod";

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

const nonEmpty = z.string().min(1);
const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//);

/**
 * Settings for outside services use vendor-neutral names (STORAGE_*, SMTP_*).
 * Any S3-compatible storage (Supabase Storage, Cloudflare R2, AWS S3) and any
 * SMTP email service (Gmail, Resend, Brevo) work by changing these values only.
 */
const serverEnvSchema = z.object({
  APP_ENV: z.enum(["dev", "production"]),

  // Database: any Postgres. Supabase today.
  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl,

  // Supabase Auth and Realtime
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,

  // File storage: any S3-compatible service.
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: nonEmpty,
  STORAGE_ACCESS_KEY_ID: nonEmpty,
  STORAGE_SECRET_ACCESS_KEY: nonEmpty,
  STORAGE_BUCKET: nonEmpty,
  STORAGE_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  // Email: any SMTP service.
  SMTP_HOST: z.string().min(1).default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: nonEmpty,
  SMTP_PASSWORD: nonEmpty,

  // Optional: with no DSN, error reporting is simply off.
  NEXT_PUBLIC_SENTRY_DSN: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates environment variables. Error messages name variables only,
 * never their values, so secrets cannot leak through logs or error pages.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "(unknown)")))];
    throw new EnvError(`Missing or invalid environment variables: ${names.join(", ")}`);
  }

  const env = result.data;
  const deployment = source.VERCEL_ENV;
  if (deployment === "preview" && env.APP_ENV === "production") {
    throw new EnvError("Refusing to start: this is a preview deployment but APP_ENV is production.");
  }
  if (deployment === "production" && env.APP_ENV !== "production") {
    throw new EnvError("Refusing to start: this is a production deployment but APP_ENV is not production.");
  }
  return env;
}

let cached: ServerEnv | undefined;

/** Reads process.env once, on first use. Never call at import time, so builds work without secrets. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
