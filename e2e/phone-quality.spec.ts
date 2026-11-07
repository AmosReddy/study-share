import { expect, test, type Page } from "@playwright/test";
import { auditInBothThemes, auditPage, type PageExpectation } from "./audit";
import {
  followEmailLink,
  forgetEmailCooldown,
  isolateRateLimits,
  lastEmailedLink,
  signUpAndConfirm,
  uniqueEmail,
} from "./helpers";

/*
  The phone quality sweep: every page of Phase 1a, audited (see ./audit.ts) in the light and
  the dark theme, at 360px wide (the small phone) and at desktop width. phone-412 is skipped
  because 360px is the tighter of the two phones. /welcome needs the one shared fake Google
  account, so it is audited in phone-quality-welcome.spec.ts, which runs in its own project.
  Every audited page names its expected address and landmark (PageExpectation), so a redirect
  to log in or a 404 page can never be audited by mistake.
*/

/** For a page with a menu or sheet open; see AuditOptions in ./audit.ts. */
const MODAL_LAYER = { skipAxeRules: ["aria-hidden-focus"] };

const NAME = "Asha Rao";

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === "phone-412", "The sweep runs at 360px and desktop; 360px is the tighter phone.");
  await isolateRateLimits(page);
});

const h1 = (name: string) => (page: Page) => page.getByRole("heading", { level: 1, name, exact: true });
/** The signed-in app shell's account menu button. */
const accountMenu = (page: Page) => page.getByRole("banner").getByRole("button", { name: NAME, exact: true });
/** The signed-out pitch's "Sign up" link. */
const pitchSignUp = (page: Page) => page.getByRole("main").getByRole("link", { name: "Sign up", exact: true });

const SIGNED_OUT_PAGES: Record<string, PageExpectation> = {
  "/": { path: "/", url: "/", landmark: pitchSignUp, absent: accountMenu },
  "/login": { path: "/login", url: "/login", landmark: h1("Log in") },
  "/signup": { path: "/signup", url: "/signup", landmark: h1("Create your account") },
  "/forgot-password": { path: "/forgot-password", url: "/forgot-password", landmark: h1("Reset your password") },
  "/terms": { path: "/terms", url: "/terms", landmark: h1("Terms of use") },
  "/privacy": { path: "/privacy", url: "/privacy", landmark: h1("Privacy Notice") },
};

test.describe("signed out", () => {
  for (const [name, expected] of Object.entries(SIGNED_OUT_PAGES)) {
    test(name, async ({ page }) => {
      await auditInBothThemes(page, expected);
    });
  }

  test("/login after an expired email link (with the resend form)", async ({ page }) => {
    await auditInBothThemes(page, {
      path: "/login?error=link_expired",
      url: "/login?error=link_expired",
      landmark: (p) => p.getByText("This link has expired or was already used"),
    });
  });

  test("/forgot-password after an expired reset link", async ({ page }) => {
    await auditInBothThemes(page, {
      path: "/forgot-password?error=link_expired",
      url: "/forgot-password?error=link_expired",
      landmark: (p) => p.getByText("This reset link has expired or was already used."),
    });
  });

  // Plain HTML with no theme switcher of its own: it follows the device's light or dark setting.
  for (const [type, heading] of [
    ["email", "Confirm your email"],
    ["recovery", "Choose a new password"],
  ] as const) {
    test(`the email link's Continue page (${type})`, async ({ page }) => {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const response = await page.goto(`/auth/confirm?token_hash=audit-only&type=${type}&redirect_to=/`);
        expect(response?.status()).toBe(200);
        await expect(h1(heading)(page)).toBeVisible();
        await auditPage(page);
      }
    });
  }

  test("/reset-password without a reset link", async ({ page }) => {
    await auditInBothThemes(page, {
      path: "/reset-password",
      url: "/reset-password",
      landmark: h1("This link has expired"),
    });
  });
});

test.describe("signed in", () => {
  test("/ (the app shell and the empty home)", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    await expect(accountMenu(page)).toBeVisible();
    await auditInBothThemes(page, {
      path: "/",
      url: "/",
      landmark: accountMenu,
      absent: pitchSignUp,
    });
  });

  test("/account", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    await expect(accountMenu(page)).toBeVisible();
    await auditInBothThemes(page, { path: "/account", url: "/account", landmark: h1("Account") });
  });

  test("/ with the open menu and the group sheet on a phone", async ({ page }, info) => {
    await signUpAndConfirm(page, { name: NAME });
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page)).toBeVisible();
    await expect(pitchSignUp(page)).toHaveCount(0);
    await accountMenu(page).click();
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
    await signUpAndConfirm(page, { name: NAME, email });
    await page.context().clearCookies();
    await forgetEmailCooldown(page.request, email);

    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    await followEmailLink(page, await lastEmailedLink(page.request, email));
    await expect(page).toHaveURL("/reset-password");
    // The link signed this browser in, so the page can be opened again for the second theme.
    await auditInBothThemes(page, {
      path: "/reset-password",
      url: "/reset-password",
      landmark: h1("Choose a new password"),
      absent: h1("This link has expired"),
    });
  });
});

/*
  Self-checks: the helper must fail, not pass, when the page is not the intended one. Without
  these, a sweep that quietly audits a 404 page or the login page would look like a pass.
*/
test.describe("the sweep helper refuses a page that is not the intended one", () => {
  const quick = { timeout: 1000 };

  test("an error page (404)", async ({ page }) => {
    await expect(
      auditInBothThemes(page, { path: "/does-not-exist", url: "/does-not-exist", landmark: h1("Log in"), ...quick }),
    ).rejects.toThrow(/error status/);
  });

  test("a redirect to log in instead of the signed-in page", async ({ page }) => {
    // The redirect streams in after the first response, so it shows as the wrong address or a missing landmark.
    await expect(
      auditInBothThemes(page, { path: "/account", url: "/account", landmark: h1("Account"), ...quick }),
    ).rejects.toThrow(/wrong address|own landmark/);
  });

  test("the right address without the page's landmark", async ({ page }) => {
    await expect(
      auditInBothThemes(page, { path: "/login", url: "/login", landmark: h1("Some other heading"), ...quick }),
    ).rejects.toThrow(/own landmark/);
  });

  test("the signed-out pitch where the signed-in home was expected", async ({ page }) => {
    await expect(
      auditInBothThemes(page, { path: "/", url: "/", landmark: pitchSignUp, absent: pitchSignUp, ...quick }),
    ).rejects.toThrow(/look-alike/);
  });
});
