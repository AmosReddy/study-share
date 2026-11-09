import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";

/** Shared by the browser specs; all of it runs against the fake auth provider (SERVICES_MODE=fake). */

export const PASSWORD = "correct horse 1";

export function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/**
 * Gives the page its own made-up client address, so the per-IP rate limits of one test
 * (or of an earlier run against the same server) never block another. Call it from
 * `test.beforeEach`.
 */
export async function isolateRateLimits(page: Page) {
  const part = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${part()}.${part()}.${part()}` });
}

type OutboxBody = { code: string | null; purpose: "signup" | "recovery" | null };

/** The newest email the fake provider "sent" to this address: `{ code, purpose }`, or nulls when none. */
export async function latestEmail(request: APIRequestContext, email: string): Promise<OutboxBody> {
  const response = await request.get(`/api/test/outbox?email=${encodeURIComponent(email)}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as OutboxBody;
}

/** The newest code the fake provider "emailed" to this address (waits briefly for it). */
export async function lastEmailedCode(
  request: APIRequestContext,
  email: string,
  purpose: "signup" | "recovery" = "signup",
): Promise<string> {
  let code = "";
  await expect(async () => {
    const body = await latestEmail(request, email);
    expect(body.purpose).toBe(purpose);
    code = body.code ?? "";
    expect(code).toMatch(/^\d+$/);
  }).toPass({ timeout: 5000 });
  return code;
}

/**
 * Clears the address's one-email-a-minute cooldown (test mode only), so the test can send it
 * another email without waiting a minute.
 */
export async function forgetEmailCooldown(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`/api/test/forget-email-cooldown?email=${encodeURIComponent(email)}`);
  expect(response.status()).toBe(204);
}

/** The one consent box on the sign-up form. */
export const termsBox = (page: Page) => page.getByRole("checkbox", { name: /18 or older/ });

/** The code box on the code screen. */
export const codeBox = (page: Page) => page.getByLabel("Code", { exact: true });

/** Fills in and submits the sign-up form on the page that is open, and waits for the code screen. */
export async function submitSignUp(
  page: Page,
  { name, email, password = PASSWORD }: { name: string; email: string; password?: string },
): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await termsBox(page).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup\/verify/);
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
}

/** Types a code into the code box and taps Verify. */
export async function enterCode(page: Page, code: string): Promise<void> {
  await codeBox(page).fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
}

/**
 * Signs up through the real form, types the emailed code, and leaves the page signed in on
 * `/`. The sign-up form records the terms, so no /welcome step follows.
 */
export async function signUpAndConfirm(page: Page, { name, email }: { name: string; email?: string }): Promise<string> {
  const address = email ?? uniqueEmail("person");
  await page.goto("/signup");
  await submitSignUp(page, { name, email: address });
  await enterCode(page, await lastEmailedCode(page.request, address));
  await expect(page).toHaveURL("/");
  return address;
}

/** The sideways overflow of the whole document, in pixels (0 or less means none). */
export function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** The one Google account of the fake provider (see fake-auth-provider.ts). */
export const FAKE_GOOGLE_EMAIL = "google.user@example.test";

/** Fills in and submits the log-in form on the page that is open. */
export async function logIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/** Logs in on a fresh /login (cookies cleared first) and says whether it reached `/`. */
export async function passwordWorks(page: Page, email: string, password: string): Promise<boolean> {
  await page.context().clearCookies();
  await page.goto("/login");
  await logIn(page, email, password);
  const wrong = page.getByText(AUTH_MESSAGES.badLogin);
  // The signed-in home (whatever the account's name), or the one generic error.
  await expect(wrong.or(page.getByRole("main").getByRole("link", { name: "Create a group" }))).toBeVisible();
  return (await wrong.count()) === 0;
}

/** On /welcome: ticks the one consent box and continues. */
export async function acceptTermsOnWelcome(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { level: 1, name: "One last step" })).toBeVisible();
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

/** Asks Forgot password for a code and waits for the code screen. */
export async function requestResetCode(page: Page, email: string): Promise<void> {
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page).toHaveURL("/reset-password");
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
}

/** Fills the new-password step (reset step 2, or the forced step after a foreign code) and saves. */
export async function saveNewPassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}

/** A group made through the Create a group form, with what its invite and address look like. */
export type CreatedGroup = {
  id: string;
  /** The group's own page, /groups/<id>. */
  path: string;
  /** The invite as shown: the full link, its path (/invite/<token>) and the token alone. */
  link: string;
  invitePath: string;
  token: string;
  code: string;
};

export const DEFAULT_GROUP_PASSWORD = "maths-key-42";

type CreateGroupOptions = {
  name: string;
  mode: "password" | "link";
  /** Typed in "password" mode; the default is DEFAULT_GROUP_PASSWORD. Never returned: callers know it. */
  password?: string;
  description?: string;
  /** Reach the form from the home page's "Create a group" link instead of the address. */
  fromHome?: boolean;
};

/** Opens the Create a group form and fills it in. Leaves the form unsent. */
export async function fillCreateGroupForm(
  page: Page,
  { name, mode, password = DEFAULT_GROUP_PASSWORD, description = "", fromHome = false }: CreateGroupOptions,
): Promise<void> {
  if (fromHome) {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Create a group" }).click();
    await expect(page).toHaveURL("/groups/new");
    await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
  } else {
    await page.goto("/groups/new");
  }
  await page.getByLabel("Group name", { exact: true }).fill(name);
  if (description) await page.getByRole("textbox", { name: "Description (optional)" }).fill(description);
  if (mode === "link") {
    await page.getByRole("radio", { name: /Link only/ }).check();
  } else {
    await expect(page.getByRole("radio", { name: /Link and password/ })).toBeChecked();
    await page.getByLabel("Group password", { exact: true }).fill(password);
  }
}

/**
 * Creates a group through the real /groups/new form as the person signed in on `page` and reads its
 * invite from the "Group created" screen. By default it then opens the group (the page ends on its
 * Library); with `open: false` it stays on the created screen.
 */
export async function createGroupThroughForm(
  page: Page,
  options: CreateGroupOptions & { open?: boolean },
): Promise<CreatedGroup> {
  const { name, open = true } = options;
  await fillCreateGroupForm(page, options);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Group created" })).toBeVisible();

  const link = (await page.getByTestId("invite-link").textContent())?.trim() ?? "";
  const code = (await page.getByTestId("invite-code").textContent())?.trim() ?? "";
  const href = (await page.getByRole("link", { name: "Open the group" }).getAttribute("href")) ?? "";
  const id = /^\/groups\/([0-9a-f-]{36})$/.exec(href)?.[1] ?? "";
  expect(id).not.toBe("");
  expect(link).toMatch(/^http:\/\/localhost:\d+\/invite\/\S+$/);
  const invitePath = new URL(link).pathname;
  expect(invitePath).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
  expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  const group = { id, path: `/groups/${id}`, link, invitePath, token: invitePath.split("/invite/")[1] ?? "", code };

  if (open) {
    await page.getByRole("link", { name: "Open the group" }).click();
    await expect(page).toHaveURL(group.path);
    await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  }
  return group;
}
