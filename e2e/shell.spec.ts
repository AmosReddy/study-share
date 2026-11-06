import { expect, test } from "@playwright/test";
import { isolateRateLimits, sidewaysOverflow, signUpAndConfirm } from "./helpers";

/*
  The app shell is what a signed-in person sees on `/` (signed out, `/` is the pitch, which
  account.spec.ts covers). Each test signs up first, through the real flow, in fake mode.
*/

test.beforeEach(async ({ page }) => {
  await isolateRateLimits(page);
  await signUpAndConfirm(page, { name: "Asha Rao" });
});

test("no sideways scroll", async ({ page }) => {
  await page.goto("/");
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

test("group list is reachable at this screen size", async ({ page }, info) => {
  await page.goto("/");
  if (info.project.name.startsWith("phone")) {
    await page.getByRole("button", { name: "Open group list" }).click();
  }
  await expect(page.getByRole("navigation", { name: "Groups" })).toBeVisible();
});

test("saved dark theme loads with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(errors).toEqual([]);
});

test("page renders when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /theme/i })).toBeVisible();
});

test("theme toggle switches theme with the keyboard", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /theme/i });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
