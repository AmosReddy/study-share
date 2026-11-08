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
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/privacy");

  await page.context().clearCookies();
  await page.goto("/login?next=/terms");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL("/terms");
});

test("a Google person who has not accepted the terms is sent to /welcome from / and /account, and then on", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL("/welcome?next=%2F");

  // Visiting the app directly does not skip the terms, and /welcome does not bounce back (no loop).
  await page.goto("/");
  await expect(page).toHaveURL("/welcome?next=%2F");
  await page.goto("/account");
  await expect(page).toHaveURL("/welcome?next=%2Faccount");

  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("banner").getByRole("button", { name: "Google User", exact: true })).toBeVisible();
});
