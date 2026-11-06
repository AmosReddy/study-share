import { expect, test, type Page } from "@playwright/test";
import { auditPage } from "./audit";
import { isolateRateLimits, lastEmailedLink, signUpAndConfirm, uniqueEmail } from "./helpers";

/*
  The phone quality sweep: every page of Phase 1a, audited (see ./audit.ts) in the light and
  the dark theme, at 360px wide (the small phone) and at desktop width. phone-412 is skipped
  because 360px is the tighter of the two phones. /welcome needs the one shared fake Google
  account, so it is audited in phone-quality-welcome.spec.ts, which runs in the serial project.
*/

/** For a page with a menu or sheet open; see AuditOptions in ./audit.ts. */
const MODAL_LAYER = { skipAxeRules: ["aria-hidden-focus"] };

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === "phone-412", "The sweep runs at 360px and desktop; 360px is the tighter phone.");
  await isolateRateLimits(page);
});

/** Audits `path` in the light theme and then the dark one, using the browser's colour-scheme preference. */
async function auditInBothThemes(page: Page, path: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await test.step(`${path} (${colorScheme})`, async () => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /dark/ : /^(?!.*dark)/);
      await auditPage(page);
    });
  }
}

test.describe("signed out", () => {
  for (const path of ["/", "/login", "/signup", "/forgot-password", "/terms", "/privacy"]) {
    test(`${path}`, async ({ page }) => {
      await auditInBothThemes(page, path);
    });
  }

  test("/login after an expired email link (with the resend form)", async ({ page }) => {
    await auditInBothThemes(page, "/login?error=link_expired");
  });

  test("/reset-password without a reset link", async ({ page }) => {
    await auditInBothThemes(page, "/reset-password");
  });
});

test.describe("signed in", () => {
  test("/ (the app shell and the empty home)", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await auditInBothThemes(page, "/");
  });

  test("/account", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await auditInBothThemes(page, "/account");
  });

  test("/ with the open menu and the group sheet on a phone", async ({ page }, info) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: "Asha Rao", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await auditPage(page, MODAL_LAYER);
    await page.keyboard.press("Escape");

    if (info.project.name.startsWith("phone")) {
      await page.getByRole("button", { name: "Open group list" }).click();
      await expect(page.getByRole("navigation", { name: "Groups" })).toBeVisible();
      await auditPage(page, MODAL_LAYER);
    }
  });

  test("/reset-password, reached through a reset link", async ({ page }) => {
    const email = uniqueEmail("reset");
    await signUpAndConfirm(page, { name: "Asha Rao", email });
    await page.context().clearCookies();

    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    await page.goto(await lastEmailedLink(page.request, email));
    await expect(page).toHaveURL("/reset-password");
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    // The link signed this browser in, so the page can be opened again for the second theme.
    await auditInBothThemes(page, "/reset-password");
  });
});
