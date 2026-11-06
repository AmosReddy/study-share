import { defineConfig, devices } from "@playwright/test";

/*
  Browser tests run against the dev server in SERVICES_MODE=fake: sign-in, email
  and rate limits are in-memory test doubles, so no real service is needed. Every
  setting below is a dummy of the right shape, all pointing at the made-up
  project id "e2eproj" so the start-up checks in src/server/env.ts pass.
*/
const fakeServicesEnv = {
  SERVICES_MODE: "fake",
  APP_ENV: "dev",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
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

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:3000" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // A small Android phone: touch, mobile user agent, 360px wide.
      name: "phone-360",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } },
    },
    {
      name: "phone-412",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: fakeServicesEnv,
  },
});
