import { expect, test, type APIRequestContext } from "@playwright/test";
import { isolateRateLimits, sidewaysOverflow, signUpAndConfirm } from "./helpers";

/*
  A log-out that fails must say so and leave the person signed in, never end on an error page.
  The fake provider is told to fail its next signOut through a test-only route (404 outside
  SERVICES_MODE=fake). That switch is server-wide, so this file runs alone, after the other
  projects (see playwright.config.ts), and each test starts from an empty fake store.
*/

const MESSAGE = "We could not log you out. Please try again.";

test.beforeEach(async ({ page, request }) => {
  expect((await request.post("/api/test/reset")).status()).toBe(204);
  await isolateRateLimits(page);
});

async function failNextSignOut(request: APIRequestContext) {
  expect((await request.post("/api/test/fail-next-sign-out")).status()).toBe(204);
}

test("the menu shows the message, keeps the person signed in, and a retry works", async ({ page }) => {
  await signUpAndConfirm(page, { name: "Asha Rao" });
  await page.goto("/");
  const trigger = page.getByRole("banner").getByRole("button", { name: "Asha Rao", exact: true });
  await trigger.click();
  await failNextSignOut(page.request);

  const logOut = page.getByRole("menuitem", { name: "Log out" });
  await logOut.click();

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("alert")).toHaveText(MESSAGE);
  await expect(page).toHaveURL("/");
  await expect(logOut).toBeEnabled();
  expect((await logOut.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  // Still signed in: reloading keeps the name in the header.
  await page.reload();
  await expect(trigger).toBeVisible();

  // Retry (the failure was one-off).
  await trigger.click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
  await expect(trigger).toHaveCount(0);
});

test("the account page shows the message by the button, stays put, and a retry works", async ({ page }) => {
  await signUpAndConfirm(page, { name: "Asha Rao" });
  await page.goto("/account");
  const button = page.getByRole("main").getByRole("button", { name: "Log out" });
  await expect(button).toBeVisible();
  await failNextSignOut(page.request);
  await button.click();

  // The form also holds an empty live region for field errors (see useAuthForm), so pick the message.
  await expect(page.getByRole("main").getByRole("alert").filter({ hasText: MESSAGE })).toHaveText(MESSAGE);
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("banner").getByRole("button", { name: "Asha Rao", exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  await button.click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("main").getByRole("link", { name: "Log in", exact: true })).toBeVisible();
});
