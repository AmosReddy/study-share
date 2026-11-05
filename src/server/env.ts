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

const serverEnvSchema = z.object({
  APP_ENV: z.enum(["dev", "production"]),
  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl,
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  R2_ACCOUNT_ID: nonEmpty,
  R2_ACCESS_KEY_ID: nonEmpty,
  R2_SECRET_ACCESS_KEY: nonEmpty,
  R2_BUCKET: nonEmpty,
  SMTP_USER: nonEmpty,
  SMTP_APP_PASSWORD: nonEmpty,
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
