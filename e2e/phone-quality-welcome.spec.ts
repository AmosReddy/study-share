import { devices, expect, test } from "@playwright/test";
import { auditInBothThemes } from "./audit";
import { FAKE_GOOGLE_EMAIL, isolateRateLimits } from "./helpers";

/*
  /welcome is where a signed-in person whose accepted terms version is out of date is sent (a
  new Google user accepts by the sentence under the button and lands home). The fake provider
  has one Google account for the whole server, so this file starts each test from an empty
  fake store (POST /api/test/reset) and runs in its own project, after the others and after
  google.spec.ts, which resets the same store (see playwright.config.ts). That project is a
  360px phone; the desktop width is set per test.
*/

// test.use() may not set the browser type, so it is left out of the device description.
const desktopChrome: Record<string, unknown> = { ...devices["Desktop Chrome"] };
delete desktopChrome.defaultBrowserType;

const SIZES = [
  { name: "phone 360px", use: {} },
  { name: "desktop", use: { ...desktopChrome, viewport: { width: 1280, height: 800 } } },
];

test.beforeEach(async ({ page, request }) => {
  const response = await request.post("/api/test/reset");
  expect(response.status()).toBe(204);
  await isolateRateLimits(page);
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);

    test("/welcome", async ({ page }) => {
      await page.goto("/login");
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await expect(page).toHaveURL("/");
      // An older accepted version (test mode only): /welcome now has something to ask.
      const older = await page.request.post(
        `/api/test/set-terms-version?email=${encodeURIComponent(FAKE_GOOGLE_EMAIL)}&version=1999-01-01`,
      );
      expect(older.status()).toBe(204);
      // The Google sign-in left a session, so /welcome can be opened again for each theme.
      await auditInBothThemes(page, {
        path: "/welcome?next=%2F",
        url: "/welcome?next=%2F",
        landmark: (p) => p.getByRole("heading", { level: 1, name: "One last step", exact: true }),
      });
    });
  });
}
