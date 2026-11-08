import { expect, test, type Page } from "@playwright/test";
import { auditInBothThemes, auditPage, type PageExpectation } from "./audit";
import {
  codeBox,
  enterCode,
  forgetEmailCooldown,
  isolateRateLimits,
  lastEmailedCode,
  requestResetCode,
  signUpAndConfirm,
  submitSignUp,
  uniqueEmail,
} from "./helpers";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";

/*
  The phone quality sweep: every page of Phase 1a, audited (see ./audit.ts) in the light and
  the dark theme, at 360px wide (the small phone) and at desktop width. phone-412 is skipped
  because 360px is the tighter of the two phones. /welcome needs the one shared fake Google
  account, so it is audited in phone-quality-welcome.spec.ts, which runs in its own project.
  Every audited page names its expected address and landmark (PageExpectation), so a redirect
  to log in or a 404 page can never be audited by mistake.

  The code-based registration screens need state to be reached, which the test sets up through
  the real forms (the browser context keeps the cookies and the session across the two themes):
   - /signup/verify: submit the sign-up form (the pending-sign-up cookie names the address);
     and again with the cookie cleared (the screen asks for the address);
   - /signup/password: the emailed code typed with no cookie, which signs in and then forces a
     new password;
   - /reset-password: Forgot password (the reset-email cookie), and with no cookie;
   - /reset-password/new: Forgot password, then the emailed recovery code.
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

/** The Google button and the sentence under it, which sit on the log-in and sign-up pages. */
const googleButton = (page: Page) => page.getByRole("button", { name: "Continue with Google", exact: true });
const googleSentence = (page: Page) => page.locator("p").filter({ hasText: /^By continuing/ });

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

  for (const path of ["/login", "/signup"]) {
    test(`${path} has the Google button with the terms sentence under it`, async ({ page }) => {
      await page.goto(path);
      await expect(googleButton(page)).toBeVisible();
      await expect(googleSentence(page)).toHaveText(AUTH_MESSAGES.googleConsent);
      await expect(googleSentence(page).getByRole("link", { name: "Terms", exact: true })).toBeVisible();
      await expect(googleSentence(page).getByRole("link", { name: "Privacy Notice", exact: true })).toBeVisible();
      await auditInBothThemes(page, SIGNED_OUT_PAGES[path]);
    });
  }

  test("/reset-password (the code step, with no remembered address)", async ({ page }) => {
    await auditInBothThemes(page, {
      path: "/reset-password",
      url: "/reset-password",
      landmark: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(h1("Enter the code")(page)).toBeVisible();
  });

  test("/reset-password (the code step, with the remembered address)", async ({ page }) => {
    const email = uniqueEmail("sweep-reset");
    await requestResetCode(page, email);
    await auditInBothThemes(page, {
      path: "/reset-password",
      url: "/reset-password",
      landmark: codeBox,
      absent: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(page.getByRole("main")).toContainText(email);
  });

  test("/reset-password/new (the new-password step, after the emailed code)", async ({ page }) => {
    const email = uniqueEmail("sweep-new");
    // An unknown address is sent no code (the neutral reply), so the account must exist first.
    await signUpAndConfirm(page, { name: NAME, email });
    await page.context().clearCookies();
    await forgetEmailCooldown(page.request, email);
    await requestResetCode(page, email);
    await enterCode(page, await lastEmailedCode(page.request, email, "recovery"));
    await expect(page).toHaveURL("/reset-password/new");
    await auditInBothThemes(page, {
      path: "/reset-password/new",
      url: "/reset-password/new",
      landmark: h1("Create a new password"),
    });
  });

  test("/signup/verify (the code step, with the pending-sign-up cookie)", async ({ page }) => {
    const email = uniqueEmail("sweep-verify");
    await page.goto("/signup");
    await submitSignUp(page, { name: NAME, email });
    await auditInBothThemes(page, {
      path: "/signup/verify",
      url: "/signup/verify",
      landmark: codeBox,
      absent: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(page.getByRole("main")).toContainText(email);
  });

  test("/signup/verify (the code step, with no cookie: it asks for the address)", async ({ page }) => {
    await page.goto("/signup");
    await submitSignUp(page, { name: NAME, email: uniqueEmail("sweep-nocookie") });
    await page.context().clearCookies();
    await auditInBothThemes(page, {
      path: "/signup/verify",
      url: "/signup/verify",
      landmark: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(h1("Enter the code")(page)).toBeVisible();
    await expect(codeBox(page)).toBeVisible();
  });

  test("/signup/password (the forced new-password step after a code with no cookie)", async ({ page }) => {
    const email = uniqueEmail("sweep-password");
    await page.goto("/signup");
    await submitSignUp(page, { name: NAME, email });
    const code = await lastEmailedCode(page.request, email);
    // Without the cookie the code cannot tell the owner from someone else, so it signs in
    // and the person must create a password.
    await page.context().clearCookies();
    await page.reload();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await enterCode(page, code);
    await expect(page).toHaveURL("/signup/password");
    await auditInBothThemes(page, {
      path: "/signup/password",
      url: "/signup/password",
      landmark: h1("Create your password"),
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
