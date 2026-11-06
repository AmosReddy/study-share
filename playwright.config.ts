import { defineConfig, devices } from "@playwright/test";

/*
  Browser tests build and start their own production server on a dedicated port, in
  SERVICES_MODE=fake: sign-in, email and rate limits are in-memory test doubles, so no
  real service is ever called. The server is never reused, so a developer's own server
  (with real settings) or a stale one can never receive these requests, and
  e2e/global-setup.ts aborts the run unless the server answers as a test-mode server.

  Every setting the app reads is set here, because process variables win over .env
  files: nothing can be inherited from a real .env.local or .env.production.local
  (including NEXT_PUBLIC_* values, which are baked in at build time). The values are
  dummies of the right shape, all on the made-up project id "e2eproj", so the start-up
  checks in src/server/env.ts pass. An empty value counts as "not set" for the app.
*/
const PORT = 3917;
const BASE_URL = `http://localhost:${PORT}`;

const fakeServicesEnv = {
  SERVICES_MODE: "fake",
  APP_ENV: "dev",
  NEXT_PUBLIC_SITE_URL: BASE_URL,
  NEXT_PUBLIC_SENTRY_DSN: "",
  VERCEL_ENV: "",
  VERCEL_URL: "",
  VERCEL_BRANCH_URL: "",
  DATABASE_URL: "postgres://postgres.e2eproj:x@localhost:6543/postgres",
  DATABASE_MIGRATION_URL: "postgres://postgres.e2eproj:x@localhost:5432/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://e2eproj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
  STORAGE_ENDPOINT: "https://e2eproj.storage.supabase.co/storage/v1/s3",
  STORAGE_REGION: "e2e-region",
  STORAGE_ACCESS_KEY_ID: "e2e-access-key",
  STORAGE_SECRET_ACCESS_KEY: "e2e-secret-key",
  STORAGE_BUCKET: "e2e-bucket",
  STORAGE_FORCE_PATH_STYLE: "true",
  SMTP_HOST: "smtp.example.invalid",
  SMTP_PORT: "465",
  SMTP_USER: "e2e@example.invalid",
  SMTP_PASSWORD: "e2e-smtp-password",
  SMTP_FROM: "e2e@example.invalid",
};

/** Resets the shared fake store, so it runs alone, after the other projects. */
const GOOGLE_SPECS = /google\.spec\.ts/;
/** Also resets the shared fake store, so it never runs at the same time as the Google spec. */
const WELCOME_AUDIT_SPECS = /phone-quality-welcome\.spec\.ts/;
const SERIAL_SPECS = [GOOGLE_SPECS, WELCOME_AUDIT_SPECS];
/** Makes the fake provider's next sign-out fail, a server-wide switch, so it runs alone, last. */
const FAILING_SIGN_OUT_SPECS = /logout-failure\.spec\.ts/;
const phone360 = { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } };

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // On CI, also write an HTML report to playwright-report/ (uploaded with test-results/ when a run fails).
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL },
  projects: [
    {
      name: "desktop",
      testIgnore: [...SERIAL_SPECS, FAILING_SIGN_OUT_SPECS],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // A small Android phone: touch, mobile user agent, 360px wide.
      name: "phone-360",
      testIgnore: [...SERIAL_SPECS, FAILING_SIGN_OUT_SPECS],
      use: phone360,
    },
    {
      name: "phone-412",
      testIgnore: [...SERIAL_SPECS, FAILING_SIGN_OUT_SPECS],
      use: { ...devices["Pixel 7"] },
    },
    {
      // Tests that reset the shared fake store. Running them only after the others keeps
      // the reset from wiping accounts another test is still using.
      name: "phone-360-serial",
      testMatch: GOOGLE_SPECS,
      dependencies: ["desktop", "phone-360", "phone-412"],
      use: phone360,
    },
    {
      name: "phone-360-welcome-audit",
      testMatch: WELCOME_AUDIT_SPECS,
      dependencies: ["phone-360-serial"],
      use: phone360,
    },
    {
      name: "phone-360-logout-failure",
      testMatch: FAILING_SIGN_OUT_SPECS,
      dependencies: ["phone-360-welcome-audit"],
      use: phone360,
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: fakeServicesEnv,
  },
});
