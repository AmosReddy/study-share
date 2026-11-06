import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CONTACT_EMAIL } from "../src/shared/legal";

/*
  Sign-up, log-in, reset and terms, against the fake auth provider (SERVICES_MODE=fake).
  The fake is more lenient than real Supabase in two ways, so no test here relies on them:
  a recovery link also confirms an unconfirmed account, and old links stay valid after a
  resend. "Expired or reused" links below are ones that were already used or never existed.
*/

const PASSWORD = "correct horse 1";
const IN_APP_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0.0";

function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

// Each test gets its own made-up client address, so the per-IP rate limits of one test
// (or of an earlier run against the same server) never block another.
test.beforeEach(async ({ page }) => {
  const part = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${part()}.${part()}.${part()}` });
});

/** The newest link the fake provider "emailed" to this address. */
async function lastEmailedLink(request: APIRequestContext, email: string): Promise<string> {
  let url = "";
  await expect(async () => {
    const response = await request.get(`/api/test/outbox?email=${encodeURIComponent(email)}`);
    expect(response.status()).toBe(200);
    url = ((await response.json()) as { url: string | null }).url ?? "";
    expect(url).not.toBe("");
  }).toPass({ timeout: 5000 });
  return url;
}

async function fillSignUp(page: Page, { name, email, password }: { name: string; email: string; password: string }) {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

async function signUp(page: Page, email: string, path = "/signup") {
  await page.goto(path);
  await fillSignUp(page, { name: "Asha Rao", email, password: PASSWORD });
  await page.getByRole("checkbox", { name: /I'm 18 or older/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

/** Signs up and confirms, then signs out by clearing cookies. */
async function createConfirmedUser(page: Page, email: string) {
  await signUp(page, email);
  await page.goto(await lastEmailedLink(page.request, email));
  await expect(page).toHaveURL("/");
  await page.context().clearCookies();
}

async function logIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/** Signed in with the terms accepted: /welcome sends the person straight on to `/`. */
async function expectSignedIn(page: Page) {
  await page.goto("/welcome");
  await expect(page).toHaveURL("/");
}

test.describe("sign-up", () => {
  test("confirming the emailed link lands on / signed in", async ({ page }) => {
    const email = uniqueEmail("signup");
    await signUp(page, email);
    await page.goto(await lastEmailedLink(page.request, email));
    await expect(page).toHaveURL("/");
    await expectSignedIn(page);
  });

  test("an address that already has an account gets the identical screen", async ({ page }) => {
    const email = uniqueEmail("twice");
    await signUp(page, email);
    const first = await page.getByRole("main").innerText();

    await page.context().clearCookies();
    await signUp(page, email);
    expect(await page.getByRole("main").innerText()).toBe(first);
  });

  test("without the terms box ticked it shows the field error and focuses the box", async ({ page }) => {
    await page.goto("/signup");
    await fillSignUp(page, { name: "Asha Rao", email: uniqueEmail("noterms"), password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();

    const box = page.getByRole("checkbox", { name: /I'm 18 or older/ });
    await expect(page.getByText("You need to accept the terms to sign up.")).toBeVisible();
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(box).toHaveAccessibleDescription("You need to accept the terms to sign up.");
    await expect(box).toBeFocused();
    // What was typed is kept.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Asha Rao");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(PASSWORD);
  });
});

test.describe("log-in", () => {
  test("a wrong password shows one generic error, keeps the email, and a right one goes to next", async ({ page }) => {
    const email = uniqueEmail("login");
    await createConfirmedUser(page, email);

    await page.goto("/login?next=/terms");
    await logIn(page, email, "not the password");
    await expect(page.getByText("That email and password do not match.")).toHaveCount(1);
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

  test("an unconfirmed account is asked to confirm and can resend the email", async ({ page }) => {
    const email = uniqueEmail("unconfirmed");
    await signUp(page, email);
    const firstLink = await lastEmailedLink(page.request, email);

    await page.goto("/login");
    await logIn(page, email, PASSWORD);
    await expect(page.getByText("Confirm your email to log in")).toBeVisible();
    await page.getByRole("button", { name: "Resend confirmation email" }).click();
    await expect(page.getByText(/we've sent a new link/)).toBeVisible();
    expect(await lastEmailedLink(page.request, email)).not.toBe(firstLink);
  });
});

test.describe("email links", () => {
  test("a link that never existed lands on the expired-link screen with a resend form", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=never-issued&type=email&redirect_to=/");
    await expect(page).toHaveURL("/login?error=link_expired");
    await expect(page.getByText("This link has expired or was already used")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a new link" })).toBeVisible();
  });

  test("a link that was already used lands on the expired-link screen", async ({ page }) => {
    const email = uniqueEmail("reused");
    await signUp(page, email);
    const link = await lastEmailedLink(page.request, email);
    await page.goto(link);
    await expect(page).toHaveURL("/");

    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL("/login?error=link_expired");
    await expect(page.getByText("This link has expired or was already used")).toBeVisible();

    await page.getByLabel("Email", { exact: true }).first().fill(email);
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByText(/we've sent a new link/)).toBeVisible();
  });

  test("a confirmation link returns to the page the person was heading for, never off-site", async ({ page, baseURL }) => {
    const email = uniqueEmail("next");
    await signUp(page, email, "/signup?next=/privacy");
    const link = await lastEmailedLink(page.request, email);
    expect(new URL(link, baseURL).searchParams.get("redirect_to")).toBe(`${baseURL}/privacy`);
    await page.goto(link);
    await expect(page).toHaveURL("/privacy");

    await page.goto("/auth/confirm?token_hash=x&type=email&redirect_to=https://evil.com/x");
    expect(new URL(page.url()).origin).toBe(baseURL);
  });
});

test.describe("password reset", () => {
  test("unknown and known addresses get the same message, and the link sets a new password", async ({ page }) => {
    const email = uniqueEmail("reset");
    await createConfirmedUser(page, email);

    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("nobody"));
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const unknown = (await page.getByRole("main").innerText()).replace(/\S+@example\.test/, "<email>");

    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const known = (await page.getByRole("main").innerText()).replace(/\S+@example\.test/, "<email>");
    expect(known).toBe(unknown);

    await page.goto(await lastEmailedLink(page.request, email));
    await expect(page).toHaveURL("/reset-password");
    const newPassword = "a brand new secret";
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page).toHaveURL("/");
    await expectSignedIn(page);

    await page.context().clearCookies();
    await page.goto("/login");
    await logIn(page, email, PASSWORD);
    await expect(page.getByText("That email and password do not match.")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
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

    await page.goto("/login");
    await expectEmailField();
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");

    await page.goto("/forgot-password");
    await expectEmailField();
  });

  test("the terms checkbox row and the footer links are at least 44px tall", async ({ page }) => {
    await page.goto("/signup");
    const box = page.getByRole("checkbox", { name: /I'm 18 or older/ });
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
});
