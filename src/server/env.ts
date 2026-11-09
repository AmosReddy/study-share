import "server-only";
import { z } from "zod";
import { PRODUCTION_PROJECT_REFS } from "./production-projects";

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
const serverEnvSchema = z
  .object({
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
    // The address mail is sent from. Needed when the service login is not an address
    // (Resend's login is literally "resend"). Defaults to SMTP_USER, which suits Gmail.
    SMTP_FROM: z.string().optional(),

    // "fake" swaps outside services for in-memory test doubles. Never allowed on production data.
    SERVICES_MODE: z.enum(["real", "fake"]).default("real"),

    // The public address of this deployment, used for Google sign-in's return address and the
    // sign-in cookies. Empty counts as not set.
    NEXT_PUBLIC_SITE_URL: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.url().optional()),

    // Optional: with no DSN, error reporting is simply off.
    NEXT_PUBLIC_SENTRY_DSN: z
      .string()
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .transform((env) => ({ ...env, SMTP_FROM: env.SMTP_FROM?.trim() || env.SMTP_USER }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type ParseOptions = {
  /** Project ids that hold real user data. Tests pass their own. */
  productionProjectRefs?: readonly string[];
};

/**
 * Validates environment variables. Error messages name variables only,
 * never their values or project ids, so secrets cannot leak through logs or error pages.
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
  options: ParseOptions = {},
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "(unknown)")))];
    throw new EnvError(`Missing or invalid environment variables: ${names.join(", ")}`);
  }

  const env = result.data;
  const deployment = source.VERCEL_ENV;
  const productionRefs = options.productionProjectRefs ?? PRODUCTION_PROJECT_REFS;
  if (env.SERVICES_MODE === "fake") {
    // Fake mode is for local runs and CI only: never on any Vercel deployment (production,
    // preview or development), whatever the other settings say.
    const onVercel = (deployment ?? "").trim() !== "";
    const onProduction =
      env.APP_ENV === "production" ||
      Object.values(projectRefsByVariable(env)).some((ref) => productionRefs.includes(ref));
    if (onVercel || onProduction) {
      throw new EnvError(
        "Refusing to start: SERVICES_MODE=fake is only for local runs and CI, never on a Vercel deployment, on production or with production settings.",
      );
    }
  }
  // Production must say where it lives: without it, Google sign-in and cookies would fall back
  // to a Vercel deployment address.
  if (env.APP_ENV === "production" && !env.NEXT_PUBLIC_SITE_URL) {
    throw new EnvError("Missing or invalid environment variables: NEXT_PUBLIC_SITE_URL (required when APP_ENV is production)");
  }
  if (deployment === "preview" && env.APP_ENV === "production") {
    throw new EnvError("Refusing to start: this is a preview deployment but APP_ENV is production.");
  }
  if (deployment === "production" && env.APP_ENV !== "production") {
    throw new EnvError("Refusing to start: this is a production deployment but APP_ENV is not production.");
  }

  checkProjects(env, productionRefs);
  return env;
}

/**
 * APP_ENV is only a label someone typed. The settings themselves say which Supabase
 * project they really use, so check that too: a dev or preview deployment must never
 * hold a production address (for example a variable added to Vercel with "All
 * Environments" ticked), production must not run on dev data, and one deployment must
 * not mix two projects.
 */
function checkProjects(env: ServerEnv, productionRefs: readonly string[]): void {
  const refs = projectRefsByVariable(env);
  const named = Object.entries(refs);
  if (named.length === 0) return;

  // The production checks come first because their message is the most useful one.
  const onProduction = named.filter(([, ref]) => productionRefs.includes(ref)).map(([name]) => name);
  if (env.APP_ENV !== "production" && onProduction.length > 0) {
    throw new EnvError(
      `Refusing to start: APP_ENV is ${env.APP_ENV} but these settings point at the production project: ${onProduction.join(", ")}.`,
    );
  }

  const notProduction = named.filter(([, ref]) => !productionRefs.includes(ref)).map(([name]) => name);
  if (env.APP_ENV === "production" && notProduction.length > 0) {
    throw new EnvError(
      `Refusing to start: APP_ENV is production but these settings do not point at the production project: ${notProduction.join(", ")}.`,
    );
  }

  if (new Set(named.map(([, ref]) => ref)).size > 1) {
    throw new EnvError(
      `Refusing to start: these settings point at different Supabase projects: ${named.map(([name]) => name).join(", ")}.`,
    );
  }
}

/**
 * True when these settings are, or point at, production. Scripts that change data on a
 * live project (scripts/check-auth-behaviour.ts) refuse to run when this is true.
 */
export function settingsPointAtProduction(
  env: ServerEnv,
  productionRefs: readonly string[] = PRODUCTION_PROJECT_REFS,
): boolean {
  return (
    env.APP_ENV === "production" ||
    Object.values(projectRefsByVariable(env)).some((ref) => productionRefs.includes(ref))
  );
}

/** Which Supabase project each setting points at. Settings for other vendors are left out. */
function projectRefsByVariable(env: ServerEnv): Record<string, string> {
  const found: Record<string, string | undefined> = {
    DATABASE_URL: refFromDatabaseUrl(env.DATABASE_URL),
    DATABASE_MIGRATION_URL: refFromDatabaseUrl(env.DATABASE_MIGRATION_URL),
    NEXT_PUBLIC_SUPABASE_URL: refFromHost(env.NEXT_PUBLIC_SUPABASE_URL, /^([a-z0-9]+)\.supabase\.co$/),
    STORAGE_ENDPOINT: refFromHost(env.STORAGE_ENDPOINT, /^([a-z0-9]+)\.storage\.supabase\.co$/),
  };
  return Object.fromEntries(Object.entries(found).filter((entry): entry is [string, string] => !!entry[1]));
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function refFromHost(value: string, pattern: RegExp): string | undefined {
  return parseUrl(value)?.hostname.match(pattern)?.[1];
}

/** Pooler addresses carry the id in the user name (postgres.<id>); direct ones in the host (db.<id>.supabase.co). */
function refFromDatabaseUrl(value: string): string | undefined {
  const url = parseUrl(value);
  if (!url) return undefined;
  const fromUser = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]+)$/)?.[1];
  return fromUser ?? url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
}

let cached: ServerEnv | undefined;

/** Reads process.env once, on first use. Never call at import time, so builds work without secrets. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
