import { expect, test, type Page } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import {
  acceptTermsOnWelcome,
  enterCode,
  FAKE_GOOGLE_EMAIL,
  forgetEmailCooldown,
  isolateRateLimits,
  lastEmailedCode,
  passwordWorks,
  requestResetCode,
  saveNewPassword,
  signUpAndConfirm,
  submitSignUp,
} from "./helpers";

/*
  Continue with Google against the fake provider (spec 4.2, 5.3). The fake has one Google
  account (google.user@example.test, "Google User") for the whole server, so each test starts
  from an empty fake store (POST /api/test/reset), which lets it run again on the same server
  and on a CI retry. This file runs in its own project, after the others (see
  playwright.config.ts), so the reset never wipes an account another test is still using.
*/

test.beforeEach(async ({ page, request }) => {
  const response = await request.post("/api/test/reset");
  expect(response.status()).toBe(204);
  await isolateRateLimits(page);
});

const googleButton = (page: Page) => page.getByRole("button", { name: "Continue with Google" });
const accountMenu = (page: Page, name: string) => page.getByRole("banner").getByRole("button", { name, exact: true });
const signedOutPitch = (page: Page) => page.getByRole("main").getByRole("link", { name: "Sign up", exact: true });

/** Gives the fake Google account an older accepted terms version (test mode only). */
async function acceptOlderTerms(page: Page) {
  const response = await page.request.post(
    `/api/test/set-terms-version?email=${encodeURIComponent(FAKE_GOOGLE_EMAIL)}&version=1999-01-01`,
  );
  expect(response.status()).toBe(204);
}

test("the button asks Google for the account chooser, and a new Google user lands on next with the terms recorded (no /welcome)", async ({ page }) => {
  await page.goto("/login?next=/privacy");
  const toGoogle = page.waitForRequest((request) => new URL(request.url()).pathname === "/fake-google");
  await googleButton(page).click();
  const googleUrl = new URL((await toGoogle).url());
  expect(googleUrl.searchParams.get("prompt")).toBe("select_account");
  await expect(page).toHaveURL("/privacy");

  // The terms were recorded: the app opens straight away, and /welcome has nothing to ask.
  await page.goto("/");
  await expect(accountMenu(page, "Google User")).toBeVisible();
  await page.goto("/welcome");
  await expect(page).toHaveURL("/");
});

test("from /signup too, and a second visit goes straight on", async ({ page }) => {
  await page.goto("/signup");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
  await expect(accountMenu(page, "Google User")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login?next=/terms");
  await googleButton(page).click();
  await expect(page).toHaveURL("/terms");
});

test("a Google user whose accepted version is out of date goes to /welcome (also from / and /account), and only then", async ({ page }) => {
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
  await acceptOlderTerms(page);

  await page.context().clearCookies();
  await page.goto("/login?next=/account");
  await googleButton(page).click();
  await expect(page).toHaveURL("/welcome?next=%2Faccount");
  // Visiting the app directly does not skip the terms, and /welcome does not bounce back (no loop).
  await page.goto("/");
  await expect(page).toHaveURL("/welcome?next=%2F");
  await page.goto("/account");
  await expect(page).toHaveURL("/welcome?next=%2Faccount");
  await acceptTermsOnWelcome(page);
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
});

test("a stranger's pending email sign-up for the Google address: after Google the stranger's password is rejected and the name is the Google user's", async ({ page, browser, baseURL }) => {
  const strangersPassword = "the stranger's password";
  const stranger = await browser.newPage({ baseURL });
  try {
    await isolateRateLimits(stranger);
    // Earlier tests emailed this one shared address; its one-email-a-minute cooldown is not
    // part of the store reset.
    await forgetEmailCooldown(stranger.request, FAKE_GOOGLE_EMAIL);
    await stranger.goto("/signup");
    await submitSignUp(stranger, { name: "Stranger Name", email: FAKE_GOOGLE_EMAIL, password: strangersPassword });
  } finally {
    await stranger.close();
  }

  // The real owner of the address continues with Google, with no second trip to Google.
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
  await expect(accountMenu(page, "Google User")).toBeVisible();
  await expect(page.getByRole("banner")).not.toContainText("Stranger");

  expect(await passwordWorks(page, FAKE_GOOGLE_EMAIL, strangersPassword)).toBe(false);
});

test("an existing confirmed password account signs into that same account, unchanged", async ({ page }) => {
  await forgetEmailCooldown(page.request, FAKE_GOOGLE_EMAIL);
  await signUpAndConfirm(page, { name: "Owner Name", email: FAKE_GOOGLE_EMAIL });
  await page.context().clearCookies();

  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
  // The same account: the name typed at sign-up, and the password still works.
  await expect(accountMenu(page, "Owner Name")).toBeVisible();
  expect(await passwordWorks(page, FAKE_GOOGLE_EMAIL, "correct horse 1")).toBe(true);
});

test("a failed repair signs the person out and says so", async ({ page }) => {
  const response = await page.request.post("/api/test/fail-next-repair");
  expect(response.status()).toBe(204);
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/login?error=google_failed");
  await expect(page.getByRole("alert").filter({ hasText: AUTH_MESSAGES.googleFailed })).toBeVisible();

  await page.goto("/");
  await expect(signedOutPitch(page)).toBeVisible();
  // The switch fails one repair only: trying again works.
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
});

test("a Google-only account can add a password through Forgot password, then log in with it", async ({ page }) => {
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL("/");
  await page.context().clearCookies();

  await forgetEmailCooldown(page.request, FAKE_GOOGLE_EMAIL);
  await requestResetCode(page, FAKE_GOOGLE_EMAIL);
  await enterCode(page, await lastEmailedCode(page.request, FAKE_GOOGLE_EMAIL, "recovery"));
  await expect(page.getByRole("heading", { level: 1, name: "Create a new password" })).toBeVisible();
  await saveNewPassword(page, "a password for google");
  await expect(page).toHaveURL("/?password=updated");

  expect(await passwordWorks(page, FAKE_GOOGLE_EMAIL, "a password for google")).toBe(true);
  await expect(accountMenu(page, "Google User")).toBeVisible();
});
