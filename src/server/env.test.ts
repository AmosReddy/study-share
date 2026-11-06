import { describe, expect, test } from "vitest";
import { EnvError, parseServerEnv, settingsPointAtProduction } from "./env";

// Fake project ids. "prodref" stands in for the real production project.
const options = { productionProjectRefs: ["prodref"] };

function settingsFor(ref: string, appEnv: "dev" | "production") {
  return {
    APP_ENV: appEnv,
    DATABASE_URL: `postgres://postgres.${ref}:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
    DATABASE_MIGRATION_URL: `postgres://postgres.${ref}:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STORAGE_ENDPOINT: `https://${ref}.storage.supabase.co/storage/v1/s3`,
    STORAGE_REGION: "ap-south-1",
    STORAGE_ACCESS_KEY_ID: "access",
    STORAGE_SECRET_ACCESS_KEY: "secret",
    STORAGE_BUCKET: "bucket",
    SMTP_USER: "bot@gmail.com",
    SMTP_PASSWORD: "app-password",
    NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.sentry.io/1",
  };
}

const valid = settingsFor("devref", "dev");
const validProduction = settingsFor("prodref", "production");

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as Error).message;
  }
  throw new Error("expected the call to throw");
}

describe("parseServerEnv", () => {
  test("returns parsed values when all are present", () => {
    expect(parseServerEnv(valid, options).APP_ENV).toBe("dev");
  });

  test("uses Gmail and path-style storage by default, so swapping vendors is only a settings change", () => {
    const env = parseServerEnv(valid, options);
    expect(env.SMTP_HOST).toBe("smtp.gmail.com");
    expect(env.SMTP_PORT).toBe(465);
    expect(env.STORAGE_FORCE_PATH_STYLE).toBe(true);
  });

  test("accepts another email host, storage style and port", () => {
    const env = parseServerEnv(
      { ...valid, SMTP_HOST: "smtp.resend.com", SMTP_PORT: "587", STORAGE_FORCE_PATH_STYLE: "false" },
      options,
    );
    expect(env.SMTP_HOST).toBe("smtp.resend.com");
    expect(env.SMTP_PORT).toBe(587);
    expect(env.STORAGE_FORCE_PATH_STYLE).toBe(false);
  });

  test("works without a Sentry DSN", () => {
    expect(
      parseServerEnv({ ...valid, NEXT_PUBLIC_SENTRY_DSN: "" }, options).NEXT_PUBLIC_SENTRY_DSN,
    ).toBeUndefined();
  });

  test("names the missing variable and hides other values", () => {
    const { DATABASE_URL, ...rest } = valid;
    void DATABASE_URL;
    const message = messageOf(() => parseServerEnv({ ...rest, STORAGE_SECRET_ACCESS_KEY: "s3cret" }, options));
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("s3cret");
  });

  test("names an invalid variable but never prints its value", () => {
    const message = messageOf(() => parseServerEnv({ ...valid, DATABASE_URL: "hunter2" }, options));
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("hunter2");
  });

  test("refuses production settings on a Preview deployment", () => {
    expect(() => parseServerEnv({ ...validProduction, VERCEL_ENV: "preview" }, options)).toThrow(/preview/i);
  });

  test("refuses dev settings on a Production deployment", () => {
    expect(() => parseServerEnv({ ...valid, VERCEL_ENV: "production" }, options)).toThrow(/production/i);
  });

  test("allows matching settings on Vercel", () => {
    expect(parseServerEnv({ ...valid, VERCEL_ENV: "preview" }, options).APP_ENV).toBe("dev");
    expect(parseServerEnv({ ...validProduction, VERCEL_ENV: "production" }, options).APP_ENV).toBe("production");
  });
});

describe("parseServerEnv: which project the settings point at", () => {
  test("refuses a dev deployment that was given the production database, even with APP_ENV=dev", () => {
    // The mistake: a production URL added to Vercel with "All Environments" ticked.
    const message = messageOf(() =>
      parseServerEnv({ ...valid, VERCEL_ENV: "preview", DATABASE_URL: validProduction.DATABASE_URL }, options),
    );
    expect(message).toContain("DATABASE_URL");
    expect(message).toMatch(/production/i);
  });

  test("refuses a dev deployment that was given production file storage", () => {
    const message = messageOf(() =>
      parseServerEnv({ ...valid, STORAGE_ENDPOINT: validProduction.STORAGE_ENDPOINT }, options),
    );
    expect(message).toContain("STORAGE_ENDPOINT");
  });

  test("refuses to run a local dev server with the production settings file loaded", () => {
    // No VERCEL_ENV here: this is `next dev` or `next start` on a laptop.
    expect(() => parseServerEnv({ ...valid, ...validProduction, APP_ENV: "dev" }, options)).toThrow(/production/i);
  });

  test("refuses settings that mix two different projects", () => {
    const message = messageOf(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "https://otherref.supabase.co" }, options),
    );
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toMatch(/different/i);
  });

  test("refuses production settings that point at a non-production project", () => {
    const message = messageOf(() => parseServerEnv({ ...valid, APP_ENV: "production" }, options));
    expect(message).toMatch(/APP_ENV is production/i);
  });

  test("never prints a project id in the error", () => {
    const message = messageOf(() =>
      parseServerEnv({ ...valid, DATABASE_URL: validProduction.DATABASE_URL }, options),
    );
    expect(message).not.toContain("prodref");
    expect(message).not.toContain("devref");
  });

  test("ignores storage that is not Supabase, so moving file storage elsewhere still works", () => {
    const env = parseServerEnv(
      { ...valid, STORAGE_ENDPOINT: "https://acct.r2.cloudflarestorage.com" },
      options,
    );
    expect(env.STORAGE_ENDPOINT).toContain("r2.cloudflarestorage.com");
  });

  test("accepts a direct Supabase database address as well as the pooler", () => {
    const env = parseServerEnv(
      { ...validProduction, DATABASE_URL: "postgres://postgres:pw@db.prodref.supabase.co:5432/postgres" },
      options,
    );
    expect(env.APP_ENV).toBe("production");
  });
});

describe("settingsPointAtProduction (used by the live check scripts)", () => {
  test("is false for dev settings", () => {
    expect(settingsPointAtProduction(parseServerEnv(valid, options), options.productionProjectRefs)).toBe(false);
  });

  test("is true for production settings", () => {
    const env = parseServerEnv({ ...validProduction, NEXT_PUBLIC_SITE_URL: "https://study.example.com" }, options);
    expect(settingsPointAtProduction(env, options.productionProjectRefs)).toBe(true);
  });

  test("is true when APP_ENV says production, whatever the addresses", () => {
    const env = { ...parseServerEnv(valid, options), APP_ENV: "production" as const };
    expect(settingsPointAtProduction(env, options.productionProjectRefs)).toBe(true);
  });
});

describe("parseServerEnv: email sender address", () => {
  test("sends from the login address by default", () => {
    expect(parseServerEnv(valid, options).SMTP_FROM).toBe("bot@gmail.com");
  });

  test("uses SMTP_FROM when the email service login is not the sending address", () => {
    const env = parseServerEnv({ ...valid, SMTP_USER: "resend", SMTP_FROM: "StudyShare <hello@example.com>" }, options);
    expect(env.SMTP_USER).toBe("resend");
    expect(env.SMTP_FROM).toBe("StudyShare <hello@example.com>");
  });

  test("treats an empty SMTP_FROM as not set", () => {
    expect(parseServerEnv({ ...valid, SMTP_FROM: "  " }, options).SMTP_FROM).toBe("bot@gmail.com");
  });
});

describe("parseServerEnv: test-mode setting (SERVICES_MODE)", () => {
  test("defaults to real", () => {
    expect(parseServerEnv(valid, options).SERVICES_MODE).toBe("real");
  });

  test("accepts fake for a dev environment", () => {
    expect(parseServerEnv({ ...valid, SERVICES_MODE: "fake" }, options).SERVICES_MODE).toBe("fake");
  });

  test("rejects a value that is neither real nor fake", () => {
    const message = messageOf(() => parseServerEnv({ ...valid, SERVICES_MODE: "mock-it" }, options));
    expect(message).toContain("SERVICES_MODE");
    expect(message).not.toContain("mock-it");
  });

  test("refuses fake when APP_ENV is production", () => {
    const message = messageOf(() => parseServerEnv({ ...validProduction, SERVICES_MODE: "fake" }, options));
    expect(message).toContain("SERVICES_MODE");
  });

  test("refuses fake on a Vercel production deployment", () => {
    const message = messageOf(() =>
      parseServerEnv({ ...valid, VERCEL_ENV: "production", SERVICES_MODE: "fake" }, options),
    );
    expect(message).toContain("SERVICES_MODE");
  });

  test("refuses fake when any setting points at a production project", () => {
    const message = messageOf(() =>
      parseServerEnv(
        { ...valid, DATABASE_URL: validProduction.DATABASE_URL, SERVICES_MODE: "fake" },
        options,
      ),
    );
    expect(message).toContain("SERVICES_MODE");
    expect(message).not.toContain("prodref");
  });

  test("still allows real in production", () => {
    expect(parseServerEnv({ ...validProduction, SERVICES_MODE: "real" }, options).SERVICES_MODE).toBe("real");
  });
});

describe("parseServerEnv: site address setting", () => {
  test("is optional", () => {
    expect(parseServerEnv(valid, options).NEXT_PUBLIC_SITE_URL).toBeUndefined();
  });

  test("accepts a URL", () => {
    const env = parseServerEnv({ ...valid, NEXT_PUBLIC_SITE_URL: "https://study.example.com" }, options);
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://study.example.com");
  });

  test("rejects something that is not a URL", () => {
    expect(messageOf(() => parseServerEnv({ ...valid, NEXT_PUBLIC_SITE_URL: "not a url" }, options))).toContain(
      "NEXT_PUBLIC_SITE_URL",
    );
  });
});
