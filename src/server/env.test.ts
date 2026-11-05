import { describe, expect, test } from "vitest";
import { EnvError, parseServerEnv } from "./env";

const valid = {
  APP_ENV: "dev",
  DATABASE_URL: "postgres://user:pw@db.example.com:6543/postgres",
  DATABASE_MIGRATION_URL: "postgres://user:pw@db.example.com:5432/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
  SMTP_USER: "bot@gmail.com",
  SMTP_APP_PASSWORD: "app-password",
  NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.sentry.io/1",
};

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
    expect(parseServerEnv(valid).APP_ENV).toBe("dev");
  });

  test("works without a Sentry DSN", () => {
    const { NEXT_PUBLIC_SENTRY_DSN, ...rest } = valid;
    void NEXT_PUBLIC_SENTRY_DSN;
    expect(parseServerEnv({ ...rest, NEXT_PUBLIC_SENTRY_DSN: "" }).NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  test("names the missing variable and hides other values", () => {
    const { DATABASE_URL, ...rest } = valid;
    void DATABASE_URL;
    const message = messageOf(() => parseServerEnv({ ...rest, R2_SECRET_ACCESS_KEY: "s3cret" }));
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("s3cret");
  });

  test("names an invalid variable but never prints its value", () => {
    const message = messageOf(() => parseServerEnv({ ...valid, DATABASE_URL: "hunter2" }));
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("hunter2");
  });

  test("refuses production settings on a Preview deployment", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production", VERCEL_ENV: "preview" })).toThrow(/preview/i);
  });

  test("refuses dev settings on a Production deployment", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "dev", VERCEL_ENV: "production" })).toThrow(/production/i);
  });

  test("allows matching settings on Vercel", () => {
    expect(parseServerEnv({ ...valid, APP_ENV: "dev", VERCEL_ENV: "preview" }).APP_ENV).toBe("dev");
    expect(parseServerEnv({ ...valid, APP_ENV: "production", VERCEL_ENV: "production" }).APP_ENV).toBe(
      "production",
    );
  });
});
