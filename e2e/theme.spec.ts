import { expect, test, type Page } from "@playwright/test";
import { isolateRateLimits } from "./helpers";

/*
  The site opens in the light theme for everyone, whatever the device prefers. Dark is only a
  choice made with the theme toggle, and that choice is remembered. Signed out, so these run on
  the sign-in page, which has the same toggle as the app shell.
*/

test.beforeEach(async ({ page }) => {
  await isolateRateLimits(page);
});

const toggle = (page: Page) => page.getByRole("button", { name: "Toggle theme" });
const LIGHT = /^(?!.*dark)/;

test("a device set to dark still opens the site in light, with no flash of dark first", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  // The class must already be right when the page first starts to paint, before React runs.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __darkAtDomReady: boolean }).__darkAtDomReady = document.documentElement.classList.contains("dark");
    });
  });
  await page.goto("/login");
  await expect(toggle(page)).toBeVisible();
  await expect(page.locator("html")).toHaveClass(LIGHT);
  expect(await page.evaluate(() => (window as unknown as { __darkAtDomReady: boolean }).__darkAtDomReady)).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
});

test("a device set to light opens the site in light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await expect(toggle(page)).toBeVisible();
  await expect(page.locator("html")).toHaveClass(LIGHT);
});

test("with a dark device, the toggle makes it dark, it stays dark after a reload, and the toggle flips it back", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(LIGHT);

  await toggle(page).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.reload();
  await expect(toggle(page)).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await toggle(page).click();
  await expect(page.locator("html")).toHaveClass(LIGHT);
  await page.reload();
  await expect(toggle(page)).toBeVisible();
  await expect(page.locator("html")).toHaveClass(LIGHT);
});
