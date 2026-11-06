import { expect, type APIRequestContext, type Page } from "@playwright/test";

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

/** The newest link the fake provider "emailed" to this address. */
export async function lastEmailedLink(request: APIRequestContext, email: string): Promise<string> {
  let url = "";
  await expect(async () => {
    const response = await request.get(`/api/test/outbox?email=${encodeURIComponent(email)}`);
    expect(response.status()).toBe(200);
    url = ((await response.json()) as { url: string | null }).url ?? "";
    expect(url).not.toBe("");
  }).toPass({ timeout: 5000 });
  return url;
}

/**
 * Signs up through the real form, opens the emailed confirmation link, and leaves the
 * page signed in on `/`. The sign-up form records the terms, so no /welcome step follows.
 */
export async function signUpAndConfirm(page: Page, { name, email }: { name: string; email?: string }): Promise<string> {
  const address = email ?? uniqueEmail("person");
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("checkbox", { name: /I'm 18 or older/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await lastEmailedLink(page.request, address));
  await expect(page).toHaveURL("/");
  return address;
}

/** The sideways overflow of the whole document, in pixels (0 or less means none). */
export function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
