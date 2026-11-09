import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import { GROUP_MESSAGES } from "../src/shared/group-messages";
import { auditPage } from "./audit";
import {
  acceptTermsOnWelcome,
  createGroupThroughForm,
  DEFAULT_GROUP_PASSWORD,
  enterCode,
  isolateRateLimits,
  lastEmailedCode,
  logIn,
  PASSWORD,
  sidewaysOverflow,
  signUpAndConfirm,
  submitSignUp,
  uniqueEmail,
} from "./helpers";

/*
  The invite page (/invite/<link token or group code>), Join by code (/join), and the way back to
  the invite through sign-up, log-in, Google and the Terms step. The owner works in the test's own
  browser; each friend gets a browser of their own (sized like this project's device), so the two
  never share a session. Nothing here resets the shared fake store: the fake Google account is the
  same for every test on the server, so the Google test only signs in with it and never changes it.
*/

const OWNER = "Asha Rao";
const FRIEND = "Ravi Kumar";
const GROUP_PASSWORD = DEFAULT_GROUP_PASSWORD;
const DESCRIPTION = "Notes and papers for the 2026 batch.";

/** Other people's browsers, opened by a test; closed after it. */
let extraContexts: BrowserContext[] = [];
let ownerEmail = "";

test.beforeEach(async ({ page }) => {
  extraContexts = [];
  await isolateRateLimits(page);
  ownerEmail = await signUpAndConfirm(page, { name: OWNER });
});

test.afterEach(async () => {
  for (const context of extraContexts) await context.close();
});

type NewGroup = { id: string; link: string; path: string; token: string; code: string };

/**
 * Creates a group on /groups/new as the person signed in on `page` and reads its invite, staying
 * on the "Group created" screen. Here `path` is the INVITE's path (/invite/<token>).
 */
async function createGroup(
  page: Page,
  { name, mode, description = "" }: { name: string; mode: "password" | "link"; description?: string },
): Promise<NewGroup> {
  const group = await createGroupThroughForm(page, { name, mode, description, open: false });
  return { id: group.id, link: group.link, path: group.invitePath, token: group.token, code: group.code };
}

/** A new, signed-out browser for a friend, sized like this project's device. */
async function newBrowser(page: Page, info: TestInfo): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const context = await page.context().browser()!.newContext({
    baseURL: new URL(page.url()).origin,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  extraContexts.push(context);
  const friend = await context.newPage();
  await isolateRateLimits(friend);
  return friend;
}

/** A friend who already has an account, signed in and on `/`. */
async function signedInFriend(page: Page, info: TestInfo, name = FRIEND): Promise<Page> {
  const friend = await newBrowser(page, info);
  await signUpAndConfirm(friend, { name });
  return friend;
}

const groupHeading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const googleButton = (page: Page) => page.getByRole("button", { name: "Continue with Google", exact: true });
const signUpLink = (page: Page) => page.getByRole("link", { name: "Sign up with email", exact: true });
const logInLink = (page: Page) => page.getByRole("link", { name: "Log in", exact: true });
const joinButton = (page: Page) => page.getByRole("button", { name: "Join", exact: true });
const passwordBox = (page: Page) => page.getByLabel("Group password", { exact: true });
const codeInput = (page: Page) => page.getByRole("textbox", { name: "Group code", exact: true });
/** The inputs a person could type into (hidden form fields do not count). */
const typeable = (page: Page) => page.locator("input:not([type=hidden]), textarea, select, [contenteditable=true]");

/** Matches text that contains `part` word for word. */
const containing = (part: string) => new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/** Ends on the group page as a member. */
async function expectInGroup(page: Page, group: NewGroup, name: string) {
  await expect(page).toHaveURL(`/groups/${group.id}`);
  await expect(page.getByTestId("group-header").getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

/** The signed-in invite page for a password group: fill the password, tap Join. */
async function joinWithPassword(page: Page, password: string) {
  await passwordBox(page).fill(password);
  await joinButton(page).click();
}

test("signed-out friend sees the group name and two buttons, nothing to type", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Maths Circle", mode: "password", description: DESCRIPTION });
  const friend = await newBrowser(page, info);

  for (const key of [group.token, group.code, `${group.code.slice(0, 4).toLowerCase()}-${group.code.slice(4).toLowerCase()}`]) {
    await friend.goto(`/invite/${key}`);
    await expect(groupHeading(friend, "Maths Circle")).toBeVisible();
    await expect(googleButton(friend)).toBeVisible();
    const next = encodeURIComponent(`/invite/${key}`);
    await expect(signUpLink(friend)).toHaveAttribute("href", `/signup?next=${next}`);
    await expect(logInLink(friend)).toHaveAttribute("href", `/login?next=${next}`);
    await expect(friend.getByText("Already have an account?")).toBeVisible();
    // The Google button records the terms for a new account, so its sentence is right under it.
    await expect(friend.locator("p").filter({ hasText: /^By continuing/ })).toHaveText(AUTH_MESSAGES.googleConsent);

    // Nothing to type, and nothing about the group but its name.
    await expect(typeable(friend)).toHaveCount(0);
    const body = await friend.locator("body").innerText();
    expect(body).not.toContain(OWNER);
    expect(body).not.toContain(ownerEmail);
    expect(body).not.toContain(DESCRIPTION);
    expect(body).not.toMatch(/member/i);
    expect(body).not.toContain(GROUP_PASSWORD);
  }

  // A key that leads nowhere: the standard message and no way to sign up from here.
  await friend.goto("/invite/made-up-key-that-is-not-real");
  await expect(friend.getByText(GROUP_MESSAGES.invalidInvite)).toBeVisible();
  await expect(googleButton(friend)).toHaveCount(0);
  await expect(signUpLink(friend)).toHaveCount(0);
  await expect(friend.getByText("Maths Circle")).toHaveCount(0);
});

test("friend signs up by email code from the invite and lands back on the same invite, then joins with the password", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Physics Lab", mode: "password" });
  const friend = await newBrowser(page, info);
  await friend.goto(group.path);
  await signUpLink(friend).click();
  await expect(friend).toHaveURL(`/signup?next=${encodeURIComponent(group.path)}`);

  const email = uniqueEmail("friend");
  await submitSignUp(friend, { name: FRIEND, email });
  await enterCode(friend, await lastEmailedCode(friend.request, email));
  await expect(friend).toHaveURL(group.path);
  await expect(groupHeading(friend, "Physics Lab")).toBeVisible();

  // Signed in now: the password box, which browsers and password managers must not fill with the
  // account's own password ("off" is ignored on password fields, so it is "new-password").
  await expect(passwordBox(friend)).toHaveAttribute("type", "password");
  await expect(passwordBox(friend)).toHaveAttribute("autocomplete", "new-password");
  for (const ignore of ["data-1p-ignore", "data-lpignore", "data-bwignore"]) {
    await expect(passwordBox(friend)).toHaveAttribute(ignore, /.*/);
  }
  await expect(friend.getByText(`Ask ${OWNER} for the group password.`)).toBeVisible();
  await joinWithPassword(friend, GROUP_PASSWORD);
  await expectInGroup(friend, group, "Physics Lab");
});

test("wrong password shows the field error, five wrong passwords show the locked message even with the right one", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Locked Group", mode: "password" });
  // A fresh person: the five tries are counted per person per group.
  const friend = await signedInFriend(page, info);
  await friend.goto(group.path);

  const wrong = "not-the-password";
  for (let attempt = 1; attempt <= 5; attempt++) {
    await joinWithPassword(friend, `${wrong}-${attempt}`);
    await expect(passwordBox(friend)).toHaveAttribute("aria-invalid", "true");
    await expect(passwordBox(friend)).toHaveAccessibleDescription(containing(GROUP_MESSAGES.wrongPassword));
    await expect(passwordBox(friend)).toBeFocused();
    await expect(friend).toHaveURL(group.path);
  }

  // What was typed is never in the address, a cookie, or the page's text.
  expect(friend.url()).not.toContain(wrong);
  for (const cookie of await friend.context().cookies()) expect(decodeURIComponent(cookie.value)).not.toContain(wrong);
  expect(await friend.locator("body").innerText()).not.toContain(wrong);

  // The sixth try is refused even with the right password, with a hint about when to try again.
  await joinWithPassword(friend, GROUP_PASSWORD);
  const alert = friend.getByRole("alert").filter({ hasText: GROUP_MESSAGES.locked });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/try again in about \d+ minutes?/i);
  await expect(friend).toHaveURL(group.path);
  await friend.goto(`/groups/${group.id}`);
  await expect(friend.getByText("This page could not be found.")).toBeVisible();
});

test("friend logs in (existing account) from the invite and joins a link-only group in one tap", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Open Chemistry", mode: "link" });
  const friend = await newBrowser(page, info);
  const email = await signUpAndConfirm(friend, { name: FRIEND });
  await friend.context().clearCookies();

  await friend.goto(group.path);
  await logInLink(friend).click();
  await expect(friend).toHaveURL(`/login?next=${encodeURIComponent(group.path)}`);
  await logIn(friend, email, PASSWORD);
  await expect(friend).toHaveURL(group.path);
  await expect(groupHeading(friend, "Open Chemistry")).toBeVisible();

  // Link only: one button, nothing to type.
  await expect(passwordBox(friend)).toHaveCount(0);
  await expect(friend.getByRole("main").locator("input:not([type=hidden])")).toHaveCount(0);
  await joinButton(friend).click();
  await expectInGroup(friend, group, "Open Chemistry");
});

test("Google returns to the same invite with the Terms sentence shown", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Google Circle", mode: "link" });
  const friend = await newBrowser(page, info);
  await friend.goto(group.path);

  // The Terms step for a Google account is the sentence under the button: pressing it accepts
  // them, so a new Google account lands straight back on the invite (spec 5.3).
  await expect(friend.locator("p").filter({ hasText: /^By continuing/ })).toHaveText(AUTH_MESSAGES.googleConsent);
  const toGoogle = friend.waitForRequest((request) => new URL(request.url()).pathname === "/fake-google");
  await googleButton(friend).click();
  const googleUrl = new URL((await toGoogle).url());
  expect(new URL(googleUrl.searchParams.get("redirect_to") ?? "", friend.url()).searchParams.get("next")).toBe(group.path);
  await expect(friend).toHaveURL(group.path);
  await expect(groupHeading(friend, "Google Circle")).toBeVisible();

  // And /welcome has nothing left to ask.
  await friend.goto(`/welcome?next=${encodeURIComponent(group.path)}`);
  await expect(friend).toHaveURL(group.path);
  await joinButton(friend).click();
  await expectInGroup(friend, group, "Google Circle");
});

test("a signed-in person whose accepted terms are out of date passes /welcome from the invite and returns to it", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Terms Circle", mode: "link" });
  const friend = await newBrowser(page, info);
  const email = await signUpAndConfirm(friend, { name: FRIEND });
  // An older accepted version for this one account (test mode only).
  const older = await friend.request.post(`/api/test/set-terms-version?email=${encodeURIComponent(email)}&version=1999-01-01`);
  expect(older.status()).toBe(204);

  await friend.goto(group.path);
  await expect(friend).toHaveURL(`/welcome?next=${encodeURIComponent(group.path)}`);
  await acceptTermsOnWelcome(friend);
  await expect(friend).toHaveURL(group.path);
  await joinButton(friend).click();
  await expectInGroup(friend, group, "Terms Circle");
});

test("friend enters the code in lower case with a hyphen on /join and reaches the invite", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Code Group", mode: "link" });
  const friend = await signedInFriend(page, info);

  await friend.getByRole("main").getByRole("link", { name: "Join with a code" }).click();
  await expect(friend).toHaveURL("/join");
  await expect(friend.getByRole("heading", { level: 1, name: "Join a group" })).toBeVisible();
  const field = codeInput(friend);
  await expect(field).toHaveAttribute("autocapitalize", "characters");
  await expect(field).toHaveAttribute("autocorrect", "off");
  await expect(field).toHaveAttribute("spellcheck", "false");
  await expect(field).toHaveAttribute("inputmode", "text");
  expect(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

  const typed = `${group.code.slice(0, 4)}-${group.code.slice(4)}`.toLowerCase();
  await field.fill(typed);
  await friend.getByRole("button", { name: "Find group", exact: true }).click();
  await expect(friend).toHaveURL(`/invite/${group.code}`);
  await expect(groupHeading(friend, "Code Group")).toBeVisible();
  await joinButton(friend).click();
  await expectInGroup(friend, group, "Code Group");
});

test("unknown code and reset link give the same message", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Reset Group", mode: "link" });
  await page.goto(`/groups/${group.id}/settings`);
  await page.getByRole("button", { name: "Reset link" }).click();
  await page.getByRole("dialog", { name: "Reset the invite link?" }).getByRole("button", { name: "Reset link" }).click();
  await expect(page.getByTestId("invite-link")).not.toHaveText(group.link);
  const newPath = new URL((await page.getByTestId("invite-link").textContent())?.trim() ?? "").pathname;

  // A new visitor, signed out, opening the old link or code: the standard message only.
  const visitor = await newBrowser(page, info);
  for (const key of [group.token, group.code]) {
    await visitor.goto(`/invite/${key}`);
    await expect(visitor.getByText(GROUP_MESSAGES.invalidInvite)).toBeVisible();
    await expect(visitor.getByText("Reset Group")).toHaveCount(0);
    await expect(signUpLink(visitor)).toHaveCount(0);
  }

  // Signed in: the old link says the same, and on /join an unknown code and the old code both do.
  const friend = await signedInFriend(page, info);
  await friend.goto(group.path);
  await expect(friend.getByText(GROUP_MESSAGES.invalidInvite)).toBeVisible();
  await expect(joinButton(friend)).toHaveCount(0);
  expect(GROUP_MESSAGES.codeNotFound).toBe(GROUP_MESSAGES.invalidInvite);
  for (const code of ["zzzz-zzzz", group.code]) {
    await friend.goto("/join");
    await codeInput(friend).fill(code);
    await friend.getByRole("button", { name: "Find group", exact: true }).click();
    await expect(codeInput(friend)).toHaveAttribute("aria-invalid", "true");
    await expect(codeInput(friend)).toHaveAccessibleDescription(containing(GROUP_MESSAGES.codeNotFound));
    await expect(codeInput(friend)).toBeFocused();
    await expect(friend).toHaveURL("/join");
  }

  // The new link works.
  await friend.goto(newPath);
  await joinButton(friend).click();
  await expectInGroup(friend, group, "Reset Group");
});

test("an existing member opening the invite goes straight to the group", async ({ page }, info) => {
  const group = await createGroup(page, { name: "Members Only", mode: "password" });

  // The owner is a member too.
  await page.goto(group.path);
  await expectInGroup(page, group, "Members Only");

  const friend = await signedInFriend(page, info);
  await friend.goto(group.path);
  await joinWithPassword(friend, GROUP_PASSWORD);
  await expectInGroup(friend, group, "Members Only");

  // The link, the code, and the code typed on /join: straight in, no password asked again.
  for (const path of [group.path, `/invite/${group.code}`]) {
    await friend.goto(path);
    await expectInGroup(friend, group, "Members Only");
  }
  await friend.goto("/join");
  await codeInput(friend).fill(group.code.toLowerCase());
  await friend.getByRole("button", { name: "Find group", exact: true }).click();
  await expectInGroup(friend, group, "Members Only");
});

test("invite page and /join have no sideways scroll at 360px and tap targets are 44px", async ({ page }, info) => {
  const name = "తెలుగు సాహిత్యం అధ్యయన బృందం 📚 Thermodynamics";
  const group = await createGroup(page, { name, mode: "password" });

  const visitor = await newBrowser(page, info);
  await visitor.goto(group.path);
  await expect(groupHeading(visitor, name)).toBeVisible();
  expect(await sidewaysOverflow(visitor)).toBeLessThanOrEqual(0);
  await auditPage(visitor);
  await visitor.goto("/invite/made-up-key-that-is-not-real");
  await expect(visitor.getByText(GROUP_MESSAGES.invalidInvite)).toBeVisible();
  await auditPage(visitor);

  const friend = await signedInFriend(page, info);
  await friend.goto(group.path);
  await expect(groupHeading(friend, name)).toBeVisible();
  await auditPage(friend);
  await joinWithPassword(friend, "wrong-password");
  await expect(passwordBox(friend)).toHaveAttribute("aria-invalid", "true");
  await auditPage(friend);
  await friend.goto("/invite/made-up-key-that-is-not-real");
  await expect(friend.getByText(GROUP_MESSAGES.invalidInvite)).toBeVisible();
  await auditPage(friend);

  await friend.goto("/join");
  await expect(codeInput(friend)).toBeVisible();
  await auditPage(friend);
  await codeInput(friend).fill("zzzz-zzzz");
  await friend.getByRole("button", { name: "Find group", exact: true }).click();
  await expect(codeInput(friend)).toHaveAttribute("aria-invalid", "true");
  expect(await sidewaysOverflow(friend)).toBeLessThanOrEqual(0);
  await auditPage(friend);
});
