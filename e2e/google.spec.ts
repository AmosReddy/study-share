import { expect, test } from "@playwright/test";

/*
  The fake provider has one Google account for the whole server, and once it accepts the
  terms it stays accepted. Each test therefore starts from an empty fake store
  (POST /api/test/reset), so it can run again on the same server and on a CI retry. This
  file runs in its own project, after the others (see playwright.config.ts), so the
  reset never wipes an account another test is still using.
*/

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/test/reset");
  expect(response.status()).toBe(204);
});

test("the Google flow goes through /welcome once, and a second visit skips it", async ({ page }) => {
  await page.goto("/login?next=/privacy");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL("/welcome?next=%2Fprivacy");
  await page.getByRole("checkbox", { name: /I'm 18 or older/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/privacy");

  await page.context().clearCookies();
  await page.goto("/login?next=/terms");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL("/terms");
});
