import { devices, expect, test } from "@playwright/test";
import { auditPage } from "./audit";
import { isolateRateLimits } from "./helpers";

/*
  /welcome is what a Google sign-in lands on until the terms are accepted. The fake provider
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

    for (const colorScheme of ["light", "dark"] as const) {
      test(`/welcome (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto("/login");
        await page.getByRole("button", { name: "Continue with Google" }).click();
        await expect(page).toHaveURL("/welcome?next=%2F");
        await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
        await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /dark/ : /^(?!.*dark)/);
        await auditPage(page);
      });
    }
  });
}
