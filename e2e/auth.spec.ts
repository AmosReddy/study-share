import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import { CODE_LENGTH } from "../src/shared/auth-schemas";
import { CONTACT_EMAIL } from "../src/shared/legal";
import {
  acceptTermsOnWelcome,
  codeBox,
  enterCode,
  FAKE_GOOGLE_EMAIL,
  forgetEmailCooldown,
  isolateRateLimits,
  lastEmailedCode,
  latestEmail,
  logIn,
  PASSWORD,
  passwordWorks,
  requestResetCode,
  saveNewPassword,
  sidewaysOverflow,
  signUpAndConfirm,
  submitSignUp,
  termsBox,
  uniqueEmail,
} from "./helpers";

/*
  Sign-up with an emailed code, Forgot password with an emailed code, log-in and the terms,
  against the fake auth provider (SERVICES_MODE=fake). Codes are read from the fake outbox
  (GET /api/test/outbox). Emails carry codes only: there is no link flow any more.
*/

const IN_APP_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0.0";

// Each test gets its own made-up client address, so the per-IP rate limits of one test
// (or of an earlier run against the same server) never block another.
test.beforeEach(async ({ page }) => {
  await isolateRateLimits(page);
});

const verifyButton = (page: Page) => page.getByRole("button", { name: "Verify", exact: true });
const resendButton = (page: Page) => page.getByRole("button", { name: /^Resend code/ });
const accountMenu = (page: Page, name: string) => page.getByRole("banner").getByRole("button", { name, exact: true });
const codeHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Enter the code" });
const passwordHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Create your password" });

/** A code of the right shape that is not `code`: every digit moved on by one. */
function wrongCode(code: string): string {
  return code.replace(/\d/g, (d) => String((Number(d) + 1) % 10));
}

/** "123456" as a person might paste it, with `separator` in the middle. */
function spaced(code: string, separator: string): string {
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)}${separator}${code.slice(half)}`;
}

/** Opens /signup (optionally with a query) and submits the form; ends on the code screen. */
async function startSignUp(page: Page, email: string, { name = "Asha Rao", password = PASSWORD, path = "/signup" } = {}) {
  await page.goto(path);
  await submitSignUp(page, { name, email, password });
}

/** A confirmed account through the code flow, then signed out (cookies cleared). */
async function createConfirmedUser(page: Page, email: string, name = "Asha Rao") {
  await signUpAndConfirm(page, { name, email });
  await page.context().clearCookies();
}

/** Fills the create-password step and submits it. */
async function createPassword(page: Page, password: string) {
  await expect(passwordHeading(page)).toBeVisible();
  await saveNewPassword(page, password);
}

/** The part of an address before the @: the name a foreign code gives the account (P13). */
const localPart = (email: string) => email.split("@")[0];

/** Types a code into the focused code box and submits with Enter, as the phone keyboard's Go does. */
async function submitCodeWithEnter(page: Page, code: string) {
  await codeBox(page).focus();
  await codeBox(page).fill(code);
  await codeBox(page).press("Enter");
}

/** A live region (role="alert") saying exactly `message`. */
const liveError = (page: Page, message: string) => page.getByRole("alert").filter({ hasText: new RegExp(`^${message.replace(/[.?]/g, "\\$&")}$`) });

/** The server-action POSTs a page sends to `path`. */
function countActionPosts(page: Page, path: string): () => number {
  let count = 0;
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === path && request.headers()["next-action"]) count++;
  });
  return () => count;
}

test.describe("sign-up with an emailed code", () => {
  test("the code signs the person in and lands on / with their name", async ({ page }) => {
    const email = uniqueEmail("signup");
    await startSignUp(page, email);
    // The screen names the address the code went to.
    await expect(page.getByRole("main")).toContainText(email);
    await enterCode(page, await lastEmailedCode(page.request, email));
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page, "Asha Rao")).toBeVisible();
  });

  test("the code screen carries on to the page the person was heading for", async ({ page }) => {
    const email = uniqueEmail("next");
    await startSignUp(page, email, { path: "/signup?next=/privacy" });
    await enterCode(page, await lastEmailedCode(page.request, email));
    await expect(page).toHaveURL("/privacy");
  });

  test("a wrong code keeps the screen with the error; after 5 wrong codes even the right one is locked", async ({ page }) => {
    const email = uniqueEmail("wrong");
    await startSignUp(page, email);
    const code = await lastEmailedCode(page.request, email);

    // Attempts 1 to 4 with Enter (the phone keyboard's Go): focus never leaves the code box, so
    // focusing it cannot announce the error; the live region must, and the box keeps focus.
    for (let attempt = 1; attempt <= 4; attempt++) {
      await submitCodeWithEnter(page, wrongCode(code));
      await expect(page.getByText(AUTH_MESSAGES.codeInvalid).first()).toBeVisible();
      await expect(codeHeading(page)).toBeVisible();
      await expect(liveError(page, AUTH_MESSAGES.codeInvalid)).toHaveCount(1);
      await expect(codeBox(page)).toBeFocused();
      // The error still belongs to the code box.
      await expect(codeBox(page)).toHaveAttribute("aria-invalid", "true");
      await expect(codeBox(page)).toHaveAccessibleDescription(AUTH_MESSAGES.codeInvalid);
    }

    // Attempt 5 by tapping Verify: focus moves back to the code box, which reads its error once;
    // the live region stays empty, so it is not said twice.
    await enterCode(page, wrongCode(code));
    await expect(codeBox(page)).toBeFocused();
    await expect(codeBox(page)).toHaveAccessibleDescription(AUTH_MESSAGES.codeInvalid);
    await expect(liveError(page, AUTH_MESSAGES.codeInvalid)).toHaveCount(0);

    // Even the right code is refused now, with the lock message, announced from the focused box.
    await submitCodeWithEnter(page, code);
    await expect(liveError(page, AUTH_MESSAGES.tooManyCodes)).toHaveCount(1);
    await expect(codeBox(page)).toBeFocused();
    await expect(codeBox(page)).toHaveAccessibleDescription(AUTH_MESSAGES.tooManyCodes);
    await expect(page).toHaveURL(/\/signup\/verify/);
  });

  test("an expired code says so, and Resend works once the countdown has run", async ({ page }) => {
    await page.clock.install();
    const email = uniqueEmail("expired");
    await startSignUp(page, email);
    const firstCode = await lastEmailedCode(page.request, email);

    // The code just went out: Resend waits for the app's one-email-a-minute cooldown.
    await expect(resendButton(page)).toBeDisabled();
    await expect(resendButton(page)).toHaveText(/Resend code in \d:\d\d/);

    // Only this address's codes: other tests run side by side on the same server.
    const expire = await page.request.post(`/api/test/expire-codes?email=${encodeURIComponent(email)}`);
    expect(expire.status()).toBe(204);
    await enterCode(page, firstCode);
    await expect(page.getByText(AUTH_MESSAGES.codeInvalid)).toBeVisible();

    await forgetEmailCooldown(page.request, email);
    await page.clock.fastForward("01:05");
    await expect(resendButton(page)).toBeEnabled();
    await expect(resendButton(page)).toHaveText("Resend code");
    await resendButton(page).click();
    await expect(page.getByText(/we've sent a new code/)).toBeVisible();
    // The countdown starts again.
    await expect(resendButton(page)).toBeDisabled();

    let secondCode = "";
    await expect(async () => {
      secondCode = await lastEmailedCode(page.request, email);
      expect(secondCode).not.toBe(firstCode);
    }).toPass({ timeout: 5000 });
    await enterCode(page, secondCode);
    await expect(page).toHaveURL("/");
  });

  test("while the countdown runs Resend is disabled, sends nothing, and the countdown keeps its width", async ({ page }) => {
    const email = uniqueEmail("cooldown");
    await startSignUp(page, email);
    await expect(resendButton(page)).toBeDisabled();
    // A countdown that does not change width as it ticks.
    const numbers = await resendButton(page).evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    expect(numbers).toContain("tabular-nums");
    const first = await lastEmailedCode(page.request, email);
    // Nothing new was sent while the button waits.
    expect((await latestEmail(page.request, email)).code).toBe(first);
  });

  test("an address that already has an account gets the clear message, and nothing is sent", async ({ page }) => {
    const email = uniqueEmail("taken");
    await createConfirmedUser(page, email);
    const before = await latestEmail(page.request, email);

    await forgetEmailCooldown(page.request, email);
    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill("Someone Else");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("another password");
    await termsBox(page).check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(AUTH_MESSAGES.emailTaken)).toBeVisible();
    await expect(page).toHaveURL("/signup");
    expect(await latestEmail(page.request, email)).toEqual(before);
    // The existing password still works.
    expect(await passwordWorks(page, email, PASSWORD)).toBe(true);
  });

  test("an address registered through Google gets the Google message, and nothing is sent", async ({ page, browser, baseURL }) => {
    // The fake provider's one Google account exists once someone has continued with Google.
    const google = await browser.newPage({ baseURL });
    try {
      await isolateRateLimits(google);
      await google.goto("/signup");
      await google.getByRole("button", { name: "Continue with Google" }).click();
      // The sentence under the button is the acceptance: a Google sign-up lands home (spec 5.3).
      await expect(google).toHaveURL("/");
    } finally {
      await google.close();
    }
    const before = await latestEmail(page.request, FAKE_GOOGLE_EMAIL);

    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill("Someone Else");
    await page.getByLabel("Email", { exact: true }).fill(FAKE_GOOGLE_EMAIL);
    await termsBox(page).check();
    // The other screen sizes run this test at the same time against the same address, and the
    // shared one-email-a-minute cooldown may answer first: clear it and try again.
    await expect(async () => {
      await forgetEmailCooldown(page.request, FAKE_GOOGLE_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill("another password");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText(AUTH_MESSAGES.googleOnly)).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    await expect(page).toHaveURL("/signup");
    expect(await latestEmail(page.request, FAKE_GOOGLE_EMAIL)).toEqual(before);
  });

  test("signing up twice: only the newest password works after the latest code", async ({ page }) => {
    const email = uniqueEmail("twice");
    await startSignUp(page, email, { password: "the first password" });

    await forgetEmailCooldown(page.request, email);
    await startSignUp(page, email, { password: "the second password" });
    await enterCode(page, await lastEmailedCode(page.request, email));
    await expect(page).toHaveURL("/");

    expect(await passwordWorks(page, email, "the first password")).toBe(false);
    expect(await passwordWorks(page, email, "the second password")).toBe(true);
  });

  test("a stranger's later sign-up: the owner's code forces a new password, then /welcome; the stranger's password and name are gone", async ({ page, browser, baseURL }) => {
    const email = uniqueEmail("stranger");
    await startSignUp(page, email, { name: "Asha Rao" });

    // Just after the owner, a stranger signs up the same address with their own password.
    const strangersPassword = "the stranger's password";
    const stranger = await browser.newPage({ baseURL });
    try {
      await isolateRateLimits(stranger);
      await forgetEmailCooldown(stranger.request, email);
      await startSignUp(stranger, email, { name: "Stranger", password: strangersPassword });
    } finally {
      await stranger.close();
    }

    // The owner's inbox now holds a code for the stranger's pending account. The owner's
    // browser did not create that account, so it is not signed straight in.
    await enterCode(page, await lastEmailedCode(page.request, email));
    await expect(page).toHaveURL("/signup/password");
    const ownersPassword = "the owner's own password";
    await createPassword(page, ownersPassword);

    // The stranger accepted the terms, not the owner: the owner confirms 18+ and the terms
    // themselves (P13). The account is named after the address, not what the stranger typed.
    await expect(page).toHaveURL("/welcome?next=%2F");
    await expect(page.getByRole("main")).toContainText(localPart(email));
    await expect(page.getByRole("main")).not.toContainText("Stranger");
    await acceptTermsOnWelcome(page);
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page, localPart(email))).toBeVisible();
    await expect(page.getByRole("banner")).not.toContainText("Stranger");

    expect(await passwordWorks(page, email, strangersPassword)).toBe(false);
    expect(await passwordWorks(page, email, ownersPassword)).toBe(true);
  });

  test("without the cookie (another device), the address and code sign in, then a password must be created", async ({ page }) => {
    const email = uniqueEmail("nocookie");
    await startSignUp(page, email);
    const code = await lastEmailedCode(page.request, email);

    await page.context().clearCookies();
    await page.reload();
    await expect(codeHeading(page)).toBeVisible();
    // No remembered address: the screen asks for it above the code box.
    const address = page.getByLabel("Email", { exact: true });
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute("autocomplete", "email");
    await address.fill(email);
    await enterCode(page, spaced(code, "-"));

    await expect(page).toHaveURL("/signup/password");
    // A mismatch submitted with Enter from the confirm field is announced there, and focus stays.
    await expect(passwordHeading(page)).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("my new device password");
    const confirm = page.getByLabel("Confirm new password", { exact: true });
    await confirm.fill("something else entirely");
    await confirm.press("Enter");
    await expect(liveError(page, AUTH_MESSAGES.passwordsDiffer)).toHaveCount(1);
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAttribute("aria-invalid", "true");
    await createPassword(page, "my new device password");
    // Without the cookie the code cannot tell the owner from someone else, so the name typed at
    // sign-up and its terms acceptance are not kept (P13): /welcome, then the address's name.
    await acceptTermsOnWelcome(page);
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page, localPart(email))).toBeVisible();
    expect(await passwordWorks(page, email, "my new device password")).toBe(true);
    // The password typed at sign-up was replaced.
    expect(await passwordWorks(page, email, PASSWORD)).toBe(false);
  });

  test("the create-password step needs a session", async ({ page }) => {
    await page.goto("/signup/password");
    await expect(page).toHaveURL("/login");
  });

  test("a reload keeps the code screen; Change email goes back to the form and forgets the address", async ({ page }) => {
    const email = uniqueEmail("reload");
    await startSignUp(page, email);
    await page.reload();
    await expect(codeHeading(page)).toBeVisible();
    await expect(page.getByRole("main")).toContainText(email);
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Change email" }).click();
    await expect(page).toHaveURL("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();

    // The code screen no longer knows the address.
    await page.goto("/signup/verify");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(email);
  });

  test("the code box: one-time-code autofill, numeric keypad, large, and a code pasted with a space works", async ({ page }) => {
    const email = uniqueEmail("codebox");
    await startSignUp(page, email);

    const box = codeBox(page);
    await expect(box).toHaveAttribute("autocomplete", "one-time-code");
    await expect(box).toHaveAttribute("inputmode", "numeric");
    // Room for a pasted code with separators ("123 456", "123-456", "12 34 56").
    const maxLength = Number(await box.getAttribute("maxlength"));
    expect(maxLength).toBeGreaterThanOrEqual(CODE_LENGTH + 3);
    const size = await box.evaluate((el) => ({ font: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height }));
    expect(size.font).toBeGreaterThanOrEqual(16);
    expect(size.height).toBeGreaterThanOrEqual(44);
    await expect(box).toBeFocused();

    // Every control on the screen is a full tap target, and nothing scrolls sideways.
    for (const button of [verifyButton(page), resendButton(page), page.getByRole("button", { name: "Change email" })]) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    // Verify sits in the first screenful, above where a phone keyboard opens.
    const verify = await verifyButton(page).boundingBox();
    const viewport = page.viewportSize();
    expect((verify?.y ?? 0) + (verify?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) * 0.6);

    const pasted = spaced(await lastEmailedCode(page.request, email), " ");
    await box.fill(pasted);
    await expect(box).toHaveValue(pasted);
    await verifyButton(page).click();
    await expect(page).toHaveURL("/");
  });

  test("a double tap on Verify submits once and signs in", async ({ page }) => {
    const email = uniqueEmail("doubletap");
    await startSignUp(page, email);
    const posts = countActionPosts(page, "/signup/verify");

    await codeBox(page).fill(await lastEmailedCode(page.request, email));
    await verifyButton(page).dblclick();
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page, "Asha Rao")).toBeVisible();
    expect(posts()).toBe(1);
    await expect(page.getByText(AUTH_MESSAGES.codeInvalid)).toHaveCount(0);
  });

  test("a signed-in person who opens /signup, /signup/verify or /login goes home", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    for (const path of ["/signup", "/signup/verify", "/login"]) {
      await page.goto(path);
      await expect(page).toHaveURL("/");
    }
  });

  test("without the terms box ticked it shows the field error and focuses the box", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill("Asha Rao");
    await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("noterms"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    const box = termsBox(page);
    await expect(page.getByText("You need to accept the terms to sign up.")).toBeVisible();
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(box).toHaveAccessibleDescription("You need to accept the terms to sign up.");
    await expect(box).toBeFocused();
    // What was typed is kept.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Asha Rao");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(PASSWORD);
  });

  test("the consent box reads as one sentence about age, Terms and Privacy Notice", async ({ page }) => {
    await page.goto("/signup");
    await expect(termsBox(page)).toHaveAccessibleName("I am 18 or older and accept the Terms and Privacy Notice");
  });
});

test.describe("log-in", () => {
  test("a wrong password shows one generic error, keeps the email, and a right one goes to next", async ({ page }) => {
    const email = uniqueEmail("login");
    await createConfirmedUser(page, email);

    await page.goto("/login?next=/terms");
    await logIn(page, email, "not the password");
    await expect(page.getByText(AUTH_MESSAGES.badLogin)).toHaveCount(1);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL("/terms");
  });

  test("a next of //evil.com lands on /", async ({ page, baseURL }) => {
    const email = uniqueEmail("evil");
    await createConfirmedUser(page, email);

    await page.goto("/login?next=//evil.com");
    await logIn(page, email, PASSWORD);
    await expect(page).toHaveURL(`${baseURL}/`);
  });

  test("shows the hint for people who signed up with Google", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Signed up with Google? Use Continue with Google.")).toBeVisible();
  });

  test("an unconfirmed account is told so, and the button sends a new code and opens the code screen", async ({ page }) => {
    const email = uniqueEmail("unconfirmed");
    await startSignUp(page, email);
    const firstCode = await lastEmailedCode(page.request, email);
    // Another device or a cleared browser: no pending sign-up cookie.
    await page.context().clearCookies();

    await page.goto("/login");
    await logIn(page, email, PASSWORD);
    await expect(page.getByText("Your email is not confirmed yet")).toBeVisible();

    await forgetEmailCooldown(page.request, email);
    await page.getByRole("button", { name: "Send a new code" }).click();
    await expect(page).toHaveURL("/signup/verify");
    await expect(codeHeading(page)).toBeVisible();
    // The address is filled in for the person.
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);

    let code = "";
    await expect(async () => {
      code = await lastEmailedCode(page.request, email);
      expect(code).not.toBe(firstCode);
    }).toPass({ timeout: 5000 });
    await enterCode(page, code);
    // Without the cookie of the browser that signed up, the person sets a password (spec 5.1)
    // and accepts the terms themselves (P13).
    await createPassword(page, "a fresh password");
    await acceptTermsOnWelcome(page);
    await expect(page).toHaveURL("/");
  });
});

test.describe("a leftover sign-up in this browser and the log-in page's new code", () => {
  test("the code screen shows and checks the address the new code went to, not the leftover one", async ({ page, browser, baseURL }) => {
    // This browser started a sign-up for A and still holds its pending cookie.
    const first = uniqueEmail("leftover-a");
    await startSignUp(page, first);

    // B is someone's unconfirmed sign-up from another browser.
    const second = uniqueEmail("leftover-b");
    const other = await browser.newPage({ baseURL });
    try {
      await isolateRateLimits(other);
      await startSignUp(other, second);
    } finally {
      await other.close();
    }

    // In this browser, B logs in, is told the email is not confirmed, and asks for a new code.
    await page.goto("/login");
    await logIn(page, second, PASSWORD);
    await expect(page.getByText("Your email is not confirmed yet")).toBeVisible();
    await forgetEmailCooldown(page.request, second);
    await page.getByRole("button", { name: "Send a new code" }).click();
    await expect(page).toHaveURL("/signup/verify");
    await expect(codeHeading(page)).toBeVisible();

    // The screen is about B (the code went there), not A from the leftover cookie.
    await expect(page.getByRole("main")).not.toContainText(first);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(second);

    // B's newest code signs in (with the one-step password of spec 5.1).
    await enterCode(page, await lastEmailedCode(page.request, second));
    await createPassword(page, "b's own new password");
    await acceptTermsOnWelcome(page);
    await expect(page).toHaveURL("/");
    expect(await passwordWorks(page, second, "b's own new password")).toBe(true);
  });
});

test.describe("forgot password with an emailed code", () => {
  const newPasswordHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Create a new password" });

  /** The code screen's visible text with the address taken out, to compare two addresses' screens. */
  async function screenText(page: Page, email: string): Promise<string> {
    // The countdown may have ticked between the two; its digits are not about the address.
    return (await page.getByRole("main").innerText()).replaceAll(email, "<address>").replace(/\d:\d\d/g, "m:ss");
  }

  test("a known and an unknown address get the same screen, and only the known one is sent a code", async ({ page }) => {
    const known = uniqueEmail("forgot-known");
    await createConfirmedUser(page, known);
    await forgetEmailCooldown(page.request, known);
    const unknown = uniqueEmail("forgot-unknown");

    await requestResetCode(page, known);
    await expect(page.getByRole("main")).toContainText(AUTH_MESSAGES.resetCodeSent);
    const knownScreen = await screenText(page, known);

    await page.context().clearCookies();
    await requestResetCode(page, unknown);
    expect(await screenText(page, unknown)).toBe(knownScreen);

    expect((await latestEmail(page.request, known)).purpose).toBe("recovery");
    expect(await latestEmail(page.request, unknown)).toEqual({ code: null, purpose: null });
  });

  test("the code then a new password: signed in here, home says Password updated, the old password is dead and another device is signed out", async ({ page, browser, baseURL }) => {
    const email = uniqueEmail("reset");
    await createConfirmedUser(page, email);

    // The same person is also signed in on another device.
    const other = await browser.newPage({ baseURL });
    try {
      await isolateRateLimits(other);
      await other.goto("/login");
      await logIn(other, email, PASSWORD);
      await expect(other).toHaveURL("/");
      await expect(accountMenu(other, "Asha Rao")).toBeVisible();

      await forgetEmailCooldown(page.request, email);
      await requestResetCode(page, email);
      await enterCode(page, await lastEmailedCode(page.request, email, "recovery"));
      await expect(page).toHaveURL("/reset-password/new");
      await expect(newPasswordHeading(page)).toBeVisible();
      // Show/hide on the new password, and password managers file it under this account.
      const field = page.getByLabel("New password", { exact: true });
      await expect(field).toHaveAttribute("autocomplete", "new-password");
      await page.getByRole("button", { name: "Show new password" }).click();
      await expect(field).toHaveAttribute("type", "text");
      await saveNewPassword(page, "my brand new password");

      await expect(page).toHaveURL("/?password=updated");
      await expect(page.getByRole("status").filter({ hasText: AUTH_MESSAGES.passwordUpdated })).toBeVisible();
      await expect(accountMenu(page, "Asha Rao")).toBeVisible();

      // The other device is signed out.
      await other.goto("/");
      await expect(other.getByRole("main").getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
      await expect(accountMenu(other, "Asha Rao")).toHaveCount(0);
    } finally {
      await other.close();
    }

    expect(await passwordWorks(page, email, PASSWORD)).toBe(false);
    expect(await passwordWorks(page, email, "my brand new password")).toBe(true);
  });

  test("a wrong code and an expired code get the one message, and Resend works once the countdown has run", async ({ page }) => {
    await page.clock.install();
    const email = uniqueEmail("reset-wrong");
    await createConfirmedUser(page, email);
    await forgetEmailCooldown(page.request, email);
    await requestResetCode(page, email);
    const code = await lastEmailedCode(page.request, email, "recovery");

    // The code just went out: Resend waits for the countdown.
    await expect(resendButton(page)).toBeDisabled();
    await expect(resendButton(page)).toHaveText(/Resend code in \d:\d\d/);

    // A wrong code, sent with the keyboard's Go from the focused box: announced there, focus kept.
    await submitCodeWithEnter(page, wrongCode(code));
    await expect(liveError(page, AUTH_MESSAGES.codeInvalid)).toHaveCount(1);
    await expect(codeBox(page)).toBeFocused();
    await expect(codeBox(page)).toHaveAccessibleDescription(AUTH_MESSAGES.codeInvalid);

    // The right code once it has expired: the same message.
    const expire = await page.request.post(`/api/test/expire-codes?email=${encodeURIComponent(email)}`);
    expect(expire.status()).toBe(204);
    await enterCode(page, code);
    await expect(codeBox(page)).toHaveAccessibleDescription(AUTH_MESSAGES.codeInvalid);
    await expect(page).toHaveURL("/reset-password");

    await forgetEmailCooldown(page.request, email);
    await page.clock.fastForward("01:05");
    await expect(resendButton(page)).toBeEnabled();
    await resendButton(page).click();
    await expect(page.getByText("If an account exists for that email, we sent a new code.")).toBeVisible();
    await expect(resendButton(page)).toBeDisabled();

    let fresh = "";
    await expect(async () => {
      fresh = await lastEmailedCode(page.request, email, "recovery");
      expect(fresh).not.toBe(code);
    }).toPass({ timeout: 5000 });
    await enterCode(page, fresh);
    await expect(newPasswordHeading(page)).toBeVisible();
  });

  test("a reload keeps the address; Change email goes back to Forgot password and forgets it", async ({ page }) => {
    const email = uniqueEmail("reset-reload");
    await requestResetCode(page, email);
    await page.reload();
    await expect(page.getByRole("main")).toContainText(email);
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Change email" }).click();
    await expect(page).toHaveURL("/forgot-password");
    await page.goto("/reset-password");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(email);
  });

  test("without the remembered address (cookies cleared) the screen asks for it, and the code still works", async ({ page }) => {
    const email = uniqueEmail("reset-nocookie");
    await createConfirmedUser(page, email);
    await forgetEmailCooldown(page.request, email);
    await requestResetCode(page, email);
    const code = await lastEmailedCode(page.request, email, "recovery");
    await page.context().clearCookies();
    await page.reload();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await enterCode(page, spaced(code, " "));
    await expect(newPasswordHeading(page)).toBeVisible();
  });

  test("the new-password step needs the session a code opens", async ({ page }) => {
    await page.goto("/reset-password/new");
    await expect(page).toHaveURL("/reset-password");
  });

  test("signed in with the password, the new-password step says to use Forgot password, with a link, and claims nothing", async ({ page }) => {
    const email = uniqueEmail("reset-password-session");
    await createConfirmedUser(page, email);
    await page.goto("/login");
    await logIn(page, email, PASSWORD);
    await expect(page).toHaveURL("/");
    await page.goto("/reset-password/new");
    // Even the current password typed as the "new" one is not reported as a change.
    await saveNewPassword(page, PASSWORD);
    const message = page.getByRole("alert").filter({ hasText: AUTH_MESSAGES.useForgotPassword });
    await expect(message).toBeVisible();
    await expect(page.getByText(AUTH_MESSAGES.otherDevicesMaybeSignedIn)).toHaveCount(0);
    await message.getByRole("link").click();
    await expect(page).toHaveURL("/forgot-password");
  });

  /** A stranger signs up the address in another browser; the account is pending with their password. */
  async function strangerSignsUp(browser: Browser, baseURL: string | undefined, email: string, password: string) {
    const stranger = await browser.newPage({ baseURL });
    try {
      await isolateRateLimits(stranger);
      await startSignUp(stranger, email, { name: "Stranger", password });
    } finally {
      await stranger.close();
    }
  }

  test("a stranger's pending sign-up: Forgot password takes the account over, and leaving at step 2 leaves the stranger's password dead", async ({ page, browser, baseURL }) => {
    const email = uniqueEmail("reset-stranger");
    const strangersPassword = "the stranger's password";
    await strangerSignsUp(browser, baseURL, email, strangersPassword);

    await forgetEmailCooldown(page.request, email);
    await requestResetCode(page, email);
    await enterCode(page, await lastEmailedCode(page.request, email, "recovery"));
    await expect(newPasswordHeading(page)).toBeVisible();
    // The person leaves here without choosing a password.
    expect(await passwordWorks(page, email, strangersPassword)).toBe(false);
  });

  test("a stranger's pending sign-up: finishing Forgot password goes through /welcome with the address's name", async ({ page, browser, baseURL }) => {
    const email = uniqueEmail("reset-stranger-finish");
    const strangersPassword = "the stranger's password";
    await strangerSignsUp(browser, baseURL, email, strangersPassword);

    await forgetEmailCooldown(page.request, email);
    await requestResetCode(page, email);
    await enterCode(page, await lastEmailedCode(page.request, email, "recovery"));
    await expect(newPasswordHeading(page)).toBeVisible();
    await saveNewPassword(page, "the owner's new password");

    // The stranger accepted the terms, not the owner, and their name is gone.
    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.getByRole("main")).toContainText(localPart(email));
    await expect(page.getByRole("main")).not.toContainText("Stranger");
    await acceptTermsOnWelcome(page);
    await expect(page).toHaveURL("/?password=updated");
    await expect(accountMenu(page, localPart(email))).toBeVisible();
    expect(await passwordWorks(page, email, strangersPassword)).toBe(false);
    expect(await passwordWorks(page, email, "the owner's new password")).toBe(true);
  });

  test("the screens are phone-sized: big numeric code box, 44px controls, 16px inputs, no sideways scroll, and no mention of a link", async ({ page }) => {
    await page.goto("/forgot-password");
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("main")).not.toContainText(/\blinks?\b/i);
    const sendCode = page.getByRole("button", { name: "Send code" });
    expect((await sendCode.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const font = await page.getByLabel("Email", { exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(font).toBeGreaterThanOrEqual(16);

    await requestResetCode(page, uniqueEmail("reset-phone"));
    await expect(page.getByRole("main")).not.toContainText(/\blinks?\b/i);
    const box = codeBox(page);
    await expect(box).toHaveAttribute("autocomplete", "one-time-code");
    await expect(box).toHaveAttribute("inputmode", "numeric");
    await expect(box).toBeFocused();
    for (const control of [verifyButton(page), resendButton(page), page.getByRole("button", { name: "Change email" })]) {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    const verify = await verifyButton(page).boundingBox();
    expect((verify?.y ?? 0) + (verify?.height ?? 0)).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) * 0.6);
  });
});

test.describe("the Google sentence", () => {
  for (const path of ["/signup", "/login"]) {
    test(`${path}: sits under the Google button, says the spec's words, links the Terms and Privacy Notice, and fits a phone`, async ({ page }) => {
      await page.goto(path);
      const google = page.getByRole("button", { name: "Continue with Google" });
      const sentence = page.locator("p").filter({ hasText: /^By continuing/ });
      await expect(sentence).toHaveText(AUTH_MESSAGES.googleConsent);
      const googleBox = await google.boundingBox();
      const sentenceBox = await sentence.boundingBox();
      expect(sentenceBox?.y ?? 0).toBeGreaterThan((googleBox?.y ?? 0) + (googleBox?.height ?? 0) - 1);
      await expect(sentence.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms");
      await expect(sentence.getByRole("link", { name: "Privacy Notice", exact: true })).toHaveAttribute("href", "/privacy");
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
      expect(sentenceBox?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    });
  }
});

// The Google sign-in flow itself is in google.spec.ts, which runs alone (see playwright.config.ts).
test.describe("Google and the terms", () => {
  test("/welcome sends a signed-out person to log in first", async ({ page }) => {
    await page.goto("/welcome?next=/privacy");
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/welcome?next=%2Fprivacy")}`);
  });

  test.describe("inside an app's built-in browser", () => {
    test.use({ userAgent: IN_APP_USER_AGENT });

    test("Google is replaced by Open in your browser with a copy-link button", async ({ page }) => {
      for (const path of ["/login", "/signup"]) {
        await page.goto(path);
        await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
        await expect(page.getByText("Open in your browser")).toBeVisible();
        await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
      }
    });
  });
});

test.describe("fields", () => {
  test("every field has the right type and autocomplete", async ({ page }) => {
    const expectEmailField = async () => {
      const email = page.getByLabel("Email", { exact: true });
      await expect(email).toHaveAttribute("type", "email");
      await expect(email).toHaveAttribute("inputmode", "email");
      await expect(email).toHaveAttribute("autocomplete", "email");
      await expect(email).toHaveAttribute("autocapitalize", "none");
      await expect(email).toHaveAttribute("spellcheck", "false");
    };

    await page.goto("/signup");
    await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("autocomplete", "name");
    await expectEmailField();
    const newPassword = page.getByLabel("Password", { exact: true });
    await expect(newPassword).toHaveAttribute("type", "password");
    await expect(newPassword).toHaveAttribute("autocomplete", "new-password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(newPassword).toHaveAttribute("type", "text");

    await page.goto("/login");
    await expectEmailField();
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");

    await page.goto("/signup/verify");
    await expectEmailField();

    await page.goto("/forgot-password");
    await expectEmailField();

    // The reset code screen with no remembered address asks for it.
    await page.goto("/reset-password");
    await expectEmailField();
  });

  test("the terms checkbox row and the footer links are at least 44px tall", async ({ page }) => {
    await page.goto("/signup");
    const box = termsBox(page);
    const row = page.locator("label").filter({ has: box });
    const rowBox = await row.boundingBox();
    expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The whole row toggles the box: tap near its bottom-left corner, below the box itself.
    await row.click({ position: { x: 4, y: (rowBox?.height ?? 44) - 4 } });
    await expect(box).toBeChecked();
    await box.focus();
    await expect(box).toBeFocused();

    for (const name of ["Terms", "Privacy"]) {
      const link = page.getByRole("contentinfo").getByRole("link", { name, exact: true });
      expect((await link.boundingBox())?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
  });

  test("the first invalid field receives focus on submit", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");

    await page.goto("/login");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  });
});

test.describe("legal pages", () => {
  for (const path of ["/terms", "/privacy"]) {
    test(`${path} loads without sign-in and shows the contact address`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText("Pilot version, to be reviewed before public launch")).toBeVisible();
      await expect(page.getByText(CONTACT_EMAIL).first()).toBeVisible();
    });
  }

  test("/privacy explains cookies and the short-lived abuse counters", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByText("We use a small set of cookies to keep you signed in. We do not use advertising or tracking cookies."),
    ).toBeVisible();
    await expect(page.getByText(/keep short-lived counters of sign-up and login attempts, keyed by email address and IP address/)).toBeVisible();
  });
});
