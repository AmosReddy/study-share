import { expect, test, type Page, type Request } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import { CODE_LENGTH } from "../src/shared/auth-schemas";
import { CONTACT_EMAIL } from "../src/shared/legal";
import {
  codeBox,
  enterCode,
  forgetEmailCooldown,
  isolateRateLimits,
  lastEmailedCode,
  latestEmail,
  PASSWORD,
  sidewaysOverflow,
  signUpAndConfirm,
  submitSignUp,
  termsBox,
  uniqueEmail,
} from "./helpers";

/*
  Sign-up with an emailed code, log-in and the terms, against the fake auth provider
  (SERVICES_MODE=fake). Codes are read from the fake outbox (GET /api/test/outbox). Emails
  carry codes only: there is no link flow any more.
*/

const IN_APP_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0.0";

/** The one Google account of the fake provider (see fake-auth-provider.ts). */
const FAKE_GOOGLE_EMAIL = "google.user@example.test";

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

async function logIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/** Logs in on a fresh /login (cookies cleared first) and says whether it reached `/`. */
async function passwordWorks(page: Page, email: string, password: string): Promise<boolean> {
  await page.context().clearCookies();
  await page.goto("/login");
  await logIn(page, email, password);
  const wrong = page.getByText(AUTH_MESSAGES.badLogin);
  // The signed-in home (whatever the account's name), or the one generic error.
  await expect(wrong.or(page.getByRole("main").getByRole("button", { name: "Create a group" }))).toBeVisible();
  return (await wrong.count()) === 0;
}

/** Fills the create-password step and submits it. */
async function createPassword(page: Page, password: string) {
  await expect(passwordHeading(page)).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}

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

    for (let attempt = 1; attempt <= 5; attempt++) {
      await enterCode(page, wrongCode(code));
      await expect(page.getByText(AUTH_MESSAGES.codeInvalid)).toBeVisible();
      await expect(codeHeading(page)).toBeVisible();
      // The error belongs to the code box, which is marked and focused for a retry.
      await expect(codeBox(page)).toHaveAttribute("aria-invalid", "true");
      await expect(codeBox(page)).toHaveAccessibleDescription(new RegExp(AUTH_MESSAGES.codeInvalid.replace(/\./g, "\\.")));
      await expect(codeBox(page)).toBeFocused();
    }

    await enterCode(page, code);
    await expect(page.getByText(AUTH_MESSAGES.tooManyCodes)).toBeVisible();
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
      await expect(google).toHaveURL(/\/welcome/);
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

  test("a stranger's later sign-up: the owner's code forces a new password, and the stranger's password is dead", async ({ page, browser, baseURL }) => {
    const email = uniqueEmail("stranger");
    await startSignUp(page, email);

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
    await expect(page).toHaveURL("/");

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
    await createPassword(page, "my new device password");
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page, "Asha Rao")).toBeVisible();
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
    // Without the cookie of the browser that signed up, the person sets a password (spec 5.1).
    await createPassword(page, "a fresh password");
    await expect(page).toHaveURL("/");
  });
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
