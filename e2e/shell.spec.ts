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

/*
  The group sheet on a phone, for a person in no groups. A very long group name in this sheet
  (cut off with an ellipsis, no sideways scroll at 360px; the Phase 0 deferred finding) is
  covered in groups.spec.ts, which creates real groups.
*/
test("phone: the group sheet opens from the menu button, shows the empty state, fits the screen and closes", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("phone"), "The sheet is the phone layout; desktop has a permanent sidebar.");
  await page.goto("/");

  const opener = page.getByRole("button", { name: "Open group list" });
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Your groups" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("navigation", { name: "Groups" }).getByText("You are not in any groups yet.")).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  // The sheet slides in; once it has stopped, it sits inside the screen.
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box !== null && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width;
    })
    .toBe(true);

  const close = sheet.getByRole("button", { name: "Close" });
  const closeBox = await close.boundingBox();
  expect(closeBox!.width).toBeGreaterThanOrEqual(44);
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});
