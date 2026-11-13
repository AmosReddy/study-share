import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import { GROUP_MESSAGES } from "../src/shared/group-messages";
import { auditPage } from "./audit";
import {
  createGroupThroughForm,
  DEFAULT_GROUP_PASSWORD,
  fillCreateGroupForm,
  isolateRateLimits,
  logIn,
  PASSWORD,
  sidewaysOverflow,
  signUpAndConfirm,
} from "./helpers";

/*
  Groups: the home list, the Create a group page and its invite card, and the group page
  (/groups/<id>) with its Library, Members and Settings tabs. Every test signs up a fresh person
  through the real flow (fake services mode). The invite page and /join have their own spec
  (invite.spec.ts); here a second person is usually put in a group through the test-only
  /api/test/join-group route, which runs the same join use-case as the invite page.
*/

const OWNER = "Asha Rao";
const MEMBER = "Ravi Kumar";
const GROUP_PASSWORD = DEFAULT_GROUP_PASSWORD;
const NOT_FOUND_TEXT = "This page could not be found.";

/** Other people's browsers, opened by a test; closed after it. */
let extraContexts: BrowserContext[] = [];
let ownerEmail = "";

test.beforeEach(async ({ page, context }) => {
  extraContexts = [];
  await isolateRateLimits(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  ownerEmail = await signUpAndConfirm(page, { name: OWNER });
});

test.afterEach(async () => {
  for (const context of extraContexts) await context.close();
});

const isPhone = (name: string) => name.startsWith("phone");
const main = (page: Page) => page.getByRole("main");

/** Opens the create page from the home link and fills it in. Leaves the form unsent. */
const fillCreateForm = (page: Page, options: { name: string; mode: "password" | "link"; password?: string }) =>
  fillCreateGroupForm(page, { ...options, fromHome: true });

/** Creates a group from the home link and stays on the "Group created" screen. */
async function createGroup(page: Page, options: { name: string; mode: "password" | "link"; password?: string }) {
  await createGroupThroughForm(page, { ...options, fromHome: true, open: false });
}

/** The invite link, as shown on the created screen. */
async function shownInviteLink(page: Page): Promise<string> {
  const link = (await page.getByTestId("invite-link").textContent())?.trim() ?? "";
  expect(link).toMatch(/^http:\/\/localhost:\d+\/invite\/\S+$/);
  return link;
}

test("home offers Create a group and Join with a code as real links", async ({ page }, info) => {
  await page.goto("/");
  await expect(main(page).getByRole("link", { name: "Create a group" })).toHaveAttribute("href", "/groups/new");
  await expect(main(page).getByRole("link", { name: "Join with a code" })).toHaveAttribute("href", "/join");
  await expect(main(page).getByText("Coming in the next step")).toHaveCount(0);

  if (isPhone(info.project.name)) await page.getByRole("button", { name: "Open group list" }).click();
  const panel = isPhone(info.project.name) ? page.getByRole("dialog", { name: "Your groups" }) : page.locator("aside");
  await expect(panel.getByRole("link", { name: "New group" })).toHaveAttribute("href", "/groups/new");
  await expect(panel.getByRole("link", { name: "Join a group" })).toHaveAttribute("href", "/join");
  for (const name of ["New group", "Join a group"]) {
    const box = await panel.getByRole("link", { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  if (isPhone(info.project.name)) await page.keyboard.press("Escape");

  await main(page).getByRole("link", { name: "Create a group" }).click();
  await expect(page).toHaveURL("/groups/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
});

test("creating a group in password mode shows the link, the code and the password once, with copy buttons", async ({ page }) => {
  await createGroup(page, { name: "Maths Circle", mode: "password" });
  const link = await shownInviteLink(page);
  const code = (await page.getByTestId("invite-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);

  // The password, once, with the warning to send it on its own.
  await expect(page.getByText(GROUP_PASSWORD, { exact: true })).toHaveCount(1);
  await expect(page.getByText("Send the password separately from the link.")).toBeVisible();

  // Each Copy button copies its own value and says "Copied".
  for (const [label, value] of [
    ["Copy link", link],
    ["Copy code", code],
    ["Copy password", GROUP_PASSWORD],
  ] as const) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(button.locator("xpath=..").getByRole("status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  }

  // WhatsApp gets the link and who to ask, never the password.
  const message = `Join Maths Circle on study-share: ${link}. Ask ${OWNER} for the group password.`;
  const whatsApp = page.getByRole("link", { name: /WhatsApp/ });
  await expect(whatsApp).toHaveAttribute("href", `https://wa.me/?text=${encodeURIComponent(message)}`);

  // The password is in no attribute of the page (data-*, value, href, ...), no link, no address and no cookie.
  const attributesWithPassword = await page.evaluate((secret) => {
    const found: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.value.includes(secret)) found.push(`${element.tagName.toLowerCase()}[${attribute.name}]`);
      }
      if (element instanceof HTMLInputElement && element.value.includes(secret)) found.push(`${element.tagName.toLowerCase()}.value`);
    }
    return found;
  }, GROUP_PASSWORD);
  expect(attributesWithPassword).toEqual([]);
  const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  for (const href of hrefs) {
    expect(href).not.toContain(GROUP_PASSWORD);
    expect(decodeURIComponent(href)).not.toContain(GROUP_PASSWORD);
  }
  expect(page.url()).not.toContain(GROUP_PASSWORD);
  for (const cookie of await page.context().cookies()) {
    expect(decodeURIComponent(cookie.value)).not.toContain(GROUP_PASSWORD);
  }

  // The group page link, and the screen meets the phone quality bar.
  await expect(page.getByRole("link", { name: "Open the group" })).toHaveAttribute("href", /^\/groups\/[0-9a-f-]{36}$/);
  await auditPage(page);
});

test("leaving the created screen and coming back never shows the password again", async ({ page }) => {
  await createGroup(page, { name: "Physics Lab", mode: "password" });
  await expect(page.getByText(GROUP_PASSWORD, { exact: true })).toBeVisible();

  // Away with an in-app link, then the browser's Back button.
  await page.getByRole("banner").getByRole("button", { name: OWNER, exact: true }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL("/account");
  await page.goBack();
  // Read at once, before anything waits: the password must not be on the page even for a moment.
  const right = await page.evaluate(() => ({ text: document.body.innerText, html: document.body.outerHTML }));
  expect(right.text).not.toContain(GROUP_PASSWORD);
  expect(right.html).not.toContain(GROUP_PASSWORD);
  await expect(page).toHaveURL("/groups/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
  await expect(page.getByText(GROUP_PASSWORD)).toHaveCount(0);
  await expect(page.getByLabel("Group password", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => document.body.outerHTML)).not.toContain(GROUP_PASSWORD);

  // And opened afresh.
  await page.goto("/groups/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
  await expect(page.getByText(GROUP_PASSWORD)).toHaveCount(0);
});

test("after logging in without a reload, tapping the Group password label focuses its own input", async ({ page }) => {
  // The log-in page stays in the browser's memory after a soft navigation (it has a password box
  // too), so ids must not repeat between pages: a label must point at the input beside it.
  await page.context().clearCookies();
  await page.goto("/login");
  await logIn(page, ownerEmail, PASSWORD);
  await expect(main(page).getByRole("link", { name: "Create a group" })).toBeVisible();
  await main(page).getByRole("link", { name: "Create a group" }).click();
  await expect(page).toHaveURL("/groups/new");

  await page.locator("label").filter({ hasText: /^Group password$/ }).click();
  await expect(page.getByLabel("Group password", { exact: true })).toBeFocused();
  // Every id on the page is used once.
  const repeated = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  });
  expect(repeated).toEqual([]);
});

test("link-only mode shows no password", async ({ page }) => {
  await fillCreateForm(page, { name: "Open Chemistry", mode: "link" });
  await expect(page.getByLabel("Group password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Group created" })).toBeVisible();

  const link = await shownInviteLink(page);
  await expect(page.getByRole("button", { name: "Copy password" })).toHaveCount(0);
  await expect(page.getByText("Send the password separately from the link.")).toHaveCount(0);
  const message = `Join Open Chemistry on study-share: ${link}`;
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute(
    "href",
    `https://wa.me/?text=${encodeURIComponent(message)}`,
  );
});

test("the new group appears in the group list (sidebar, and the phone drawer)", async ({ page }, info) => {
  await createGroup(page, { name: "Biology Notes", mode: "link" });
  const href = await page.getByRole("link", { name: "Open the group" }).getAttribute("href");

  // Straight away on the created screen, then on home.
  for (const path of [null, "/"]) {
    if (path) await page.goto(path);
    if (isPhone(info.project.name)) {
      await page.getByRole("button", { name: "Open group list" }).click();
      const sheet = page.getByRole("dialog", { name: "Your groups" });
      await expect(sheet.getByRole("navigation", { name: "Groups" }).getByRole("link", { name: "Biology Notes" })).toHaveAttribute("href", href!);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    } else {
      const nav = page.locator("aside").getByRole("navigation", { name: "Groups" });
      await expect(nav.getByRole("link", { name: "Biology Notes" })).toHaveAttribute("href", href!);
    }
  }

  // Home lists it too, and still offers both actions.
  await expect(main(page).getByRole("link", { name: "Biology Notes" })).toHaveAttribute("href", href!);
  await expect(main(page).getByRole("link", { name: "Create a group" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Join with a code" })).toBeVisible();
});

test("a 60-character name and a Telugu name show without sideways scroll at 360px", async ({ page }, info) => {
  const long = "Thermodynamics".repeat(5).slice(0, 60);
  expect([...long]).toHaveLength(60);
  const telugu = "తెలుగు సాహిత్యం అధ్యయన బృందం 📚";
  const hindi = "हिंदी व्याकरण समूह ✍️";

  for (const name of [long, telugu, hindi]) {
    await createGroup(page, { name, mode: "link" });
    await expect(main(page).getByText(name, { exact: true })).toBeVisible();
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  }

  await page.goto("/");
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await expect(main(page).getByRole("link", { name: telugu })).toBeVisible();

  if (isPhone(info.project.name)) await page.getByRole("button", { name: "Open group list" }).click();
  const scope = isPhone(info.project.name) ? page.getByRole("dialog", { name: "Your groups" }) : page.locator("aside");
  const nav = scope.getByRole("navigation", { name: "Groups" });
  // The long name is cut off with an ellipsis inside the list, which does not scroll sideways.
  const longName = nav.getByRole("link", { name: long }).locator("span");
  await expect(longName).toBeVisible();
  expect(await longName.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await longName.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
  expect(await nav.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expect(nav.getByRole("link", { name: telugu })).toBeVisible();
  await expect(nav.getByRole("link", { name: hindi })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

test("password under 6 characters shows the error on the field", async ({ page }) => {
  await fillCreateForm(page, { name: "Short Password Group", mode: "password", password: "abc" });
  await page.getByRole("button", { name: "Create group" }).click();

  const field = page.getByLabel("Group password", { exact: true });
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Use at least 6 characters\./);
  await expect(field).toBeFocused();
  // What was typed is kept, and nothing was created.
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue("Short Password Group");
  await expect(page.getByRole("heading", { level: 1, name: "Group created" })).toHaveCount(0);
  await page.goto("/");
  await expect(main(page).getByRole("link", { name: "Short Password Group" })).toHaveCount(0);
});

/** Lets the next action requests (POSTs with a Next-Action header) fail like a dropped connection, until `allow()`. */
async function breakActionRequests(page: Page) {
  let broken = true;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (broken && request.method() === "POST" && request.headers()["next-action"]) return route.abort("failed");
    return route.continue();
  });
  return { allow: () => void (broken = false) };
}

test("a request that fails shows an error on the Create form, keeps what was typed, and the form still works", async ({ page }) => {
  await fillCreateForm(page, { name: "Flaky Network Group", mode: "link" });
  const network = await breakActionRequests(page);
  await page.getByRole("button", { name: "Create group" }).click();

  const alert = page.getByRole("alert").filter({ hasText: AUTH_MESSAGES.actionFailed });
  await expect(alert).toBeVisible();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue("Flaky Network Group");
  await expect(page.getByRole("button", { name: "Create group" })).toBeEnabled();
  await expect(page.getByRole("heading", { level: 1, name: "Group created" })).toHaveCount(0);

  network.allow();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Group created" })).toBeVisible();
});

test("a request that fails shows an error in the Reset link confirm, which can be tried again", async ({ page }) => {
  const group = await createAndOpen(page, { name: "Reset Network Group", mode: "link" });
  await page.goto(`/groups/${group.id}/settings`);
  await expect(page.getByRole("region", { name: "Group details" })).toBeVisible();
  const network = await breakActionRequests(page);

  await page.getByRole("button", { name: "Reset link" }).click();
  const sheet = page.getByRole("dialog", { name: "Reset the invite link?" });
  await sheet.getByRole("button", { name: "Reset link" }).click();
  await expect(sheet.getByRole("alert").filter({ hasText: AUTH_MESSAGES.actionFailed })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Reset link" })).toBeEnabled();

  network.allow();
  await sheet.getByRole("button", { name: "Reset link" }).click();
  await expect(page.getByText("New link and code made.")).toBeVisible();
  await expect(sheet).toBeHidden();
});

/* ---------- The group page: tabs, Library, Members, Settings ---------- */

const NEW_PASSWORD = "physics-key-77";

/** A second person in their own browser, signed up and on `/`, sized like this project's device. */
async function newPerson(browser: Browser, info: TestInfo, ownerPage: Page, name: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const context = await browser.newContext({
    baseURL: new URL(ownerPage.url()).origin,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  extraContexts.push(context);
  const page = await context.newPage();
  await isolateRateLimits(page);
  await signUpAndConfirm(page, { name });
  return page;
}

type NewGroup = { id: string; link: string; token: string; code: string };

/** Creates a group, opens it from the created screen and returns its id and invite. */
async function createAndOpen(
  page: Page,
  options: { name: string; mode: "password" | "link"; password?: string },
): Promise<NewGroup> {
  const group = await createGroupThroughForm(page, { ...options, fromHome: true });
  return { id: group.id, link: group.link, token: group.token, code: group.code };
}

type JoinAnswer = { ok: boolean; groupId?: string; formError?: string; fieldErrors?: Record<string, string> };

/** Joins as the person signed in on `page`, with an invite token or a code (test-only route). */
async function joinWith(page: Page, key: string, password?: string): Promise<JoinAnswer> {
  return page.evaluate(
    async (body) => {
      const response = await fetch("/api/test/join-group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await response.json()) as JoinAnswer;
    },
    { key, password },
  );
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Group sections" });
const memberList = (page: Page) => page.getByRole("list", { name: "Members" });

test("owner sees Library, Members, Settings; a member sees Library and Members only", async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Tabs Group", mode: "link" });

  const ownerTabs = tabs(page);
  await expect(ownerTabs.getByRole("link")).toHaveText(["Library", "Members", "Settings"]);
  await expect(ownerTabs.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");

  await ownerTabs.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/members`);
  await expect(ownerTabs.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  await expect(ownerTabs.getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current", "page");

  await ownerTabs.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/settings`);
  await expect(ownerTabs.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("invite-link")).toHaveText(group.link);

  const member = await newPerson(browser, info, page, MEMBER);
  expect((await joinWith(member, group.code)).ok).toBe(true);
  await member.goto(`/groups/${group.id}`);
  await expect(member.getByRole("heading", { level: 1, name: "Tabs Group" })).toBeVisible();
  await expect(tabs(member).getByRole("link")).toHaveText(["Library", "Members"]);

  // Typing the Settings address is a plain not-found, with no invite or owner controls.
  await member.goto(`/groups/${group.id}/settings`);
  await expect(member.getByText(NOT_FOUND_TEXT)).toBeVisible();
  await expect(member.getByTestId("invite-link")).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Reset link" })).toHaveCount(0);
});

test("a plain member's pages never contain the invite link token or the group code", async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Secret Invite Group", mode: "link" });
  const member = await newPerson(browser, info, page, MEMBER);
  expect((await joinWith(member, group.code)).ok).toBe(true);

  for (const path of ["", "/members"]) {
    await member.goto(`/groups/${group.id}${path}`);
    await expect(member.getByRole("heading", { level: 1, name: "Secret Invite Group" })).toBeVisible();
    // What the page shows, and the whole HTML (with the data Next sends for the page) as fetched.
    const shown = await member.content();
    const fetched = await (await member.request.get(`/groups/${group.id}${path}`)).text();
    for (const html of [shown, fetched]) {
      expect(html).toContain("Secret Invite Group");
      expect(html).not.toContain(group.token);
      expect(html).not.toContain(group.code);
    }
  }
  // The owner does get them, on Settings (the check above is not vacuous).
  await page.goto(`/groups/${group.id}/settings`);
  await expect(page.getByTestId("invite-code")).toHaveText(group.code);
});

test("Library shows an honest empty state, not fake files", async ({ page }) => {
  const group = await createAndOpen(page, { name: "Empty Library", mode: "link" });
  const library = page.getByRole("region", { name: "Library" });
  await expect(library.getByRole("heading", { name: "No files yet" })).toBeVisible();
  await expect(library.getByText("Be the first to share something.")).toBeVisible();
  await expect(library.getByRole("list", { name: "Files" })).toHaveCount(0);
  await expect(library).not.toContainText(/.pdf|.docx|MB|KB/);
  // The only way forward is the Upload button, in the header and in the empty state.
  const upload = library.getByRole("link", { name: "Upload a file" });
  await expect(upload).toHaveCount(2);
  await expect(upload.first()).toHaveAttribute("href", `/groups/${group.id}/upload`);
});

test('Members lists names, marks the owner and "You"', async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Members Group", mode: "link" });
  const member = await newPerson(browser, info, page, MEMBER);
  expect((await joinWith(member, group.token)).ok).toBe(true);

  await tabs(page).getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/members`);
  const ownerView = memberList(page).getByRole("listitem");
  await expect(ownerView).toHaveCount(2);
  await expect(ownerView.nth(0)).toContainText(OWNER);
  await expect(ownerView.nth(0)).toContainText("Owner");
  await expect(ownerView.nth(0)).toContainText("You");
  await expect(ownerView.nth(1)).toContainText(MEMBER);
  await expect(ownerView.nth(1)).not.toContainText("Owner");
  await expect(ownerView.nth(1)).not.toContainText("You");

  await member.goto(`/groups/${group.id}/members`);
  const memberView = memberList(member).getByRole("listitem");
  await expect(memberView).toHaveCount(2);
  await expect(memberView.nth(0)).toContainText(OWNER);
  await expect(memberView.nth(0)).toContainText("Owner");
  await expect(memberView.nth(0)).not.toContainText("You");
  await expect(memberView.nth(1)).toContainText(MEMBER);
  await expect(memberView.nth(1)).toContainText("You");
});

test("a member can leave after a confirm and the group vanishes from their list", async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Leaving Group", mode: "link" });
  const member = await newPerson(browser, info, page, MEMBER);
  expect((await joinWith(member, group.code)).ok).toBe(true);
  await member.goto(`/groups/${group.id}/members`);

  // The first tap only asks; Cancel keeps everything as it was.
  await member.getByRole("button", { name: "Leave group" }).click();
  const confirm = member.getByRole("dialog", { name: "Leave Leaving Group?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(member).toHaveURL(`/groups/${group.id}/members`);

  await member.getByRole("button", { name: "Leave group" }).click();
  await member.getByRole("dialog", { name: "Leave Leaving Group?" }).getByRole("button", { name: "Leave group" }).click();
  await expect(member).toHaveURL("/");
  await expect(member.getByRole("main").getByRole("link", { name: "Leaving Group" })).toHaveCount(0);
  if (isPhone(info.project.name)) await member.getByRole("button", { name: "Open group list" }).click();
  const panel = isPhone(info.project.name) ? member.getByRole("dialog", { name: "Your groups" }) : member.locator("aside");
  await expect(panel.getByRole("navigation", { name: "Groups" })).toBeVisible();
  await expect(panel.getByRole("navigation", { name: "Groups" }).getByRole("link", { name: "Leaving Group" })).toHaveCount(0);

  // The group is gone for them, and the owner's list no longer has them.
  await member.goto(`/groups/${group.id}`);
  await expect(member.getByText(NOT_FOUND_TEXT)).toBeVisible();
  await page.goto(`/groups/${group.id}/members`);
  await expect(memberList(page).getByRole("listitem")).toHaveCount(1);
  await expect(memberList(page)).not.toContainText(MEMBER);
});

test("the owner has no Leave button and is told why", async ({ page }) => {
  const group = await createAndOpen(page, { name: "Owner Stays", mode: "link" });
  await page.goto(`/groups/${group.id}/members`);
  await expect(memberList(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Leave group" })).toHaveCount(0);
  await expect(page.getByText(GROUP_MESSAGES.ownerCannotLeave)).toBeVisible();
  // ...and is pointed to the way out: handing the group over, in Settings.
  await page.getByRole("link", { name: "Hand over this group" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/settings`);
});

test("a non-member opening /groups/<id> sees the same not-found page as a made-up id", async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Secret Circle", mode: "link" });
  const stranger = await newPerson(browser, info, page, "Meera Iyer");

  async function visit(path: string) {
    const response = await stranger.goto(path);
    await expect(stranger.getByText(NOT_FOUND_TEXT)).toBeVisible();
    return { status: response?.status(), text: await stranger.locator("body").innerText() };
  }

  const real = await visit(`/groups/${group.id}`);
  const madeUp = await visit("/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e");
  const malformed = await visit("/groups/not-a-group");
  expect(real).toEqual(madeUp);
  expect(real).toEqual(malformed);
  for (const path of [`/groups/${group.id}/members`, `/groups/${group.id}/settings`]) {
    expect(await visit(path)).toEqual(madeUp);
  }
  expect(real.text).not.toContain("Secret Circle");
  expect(real.text).not.toContain(OWNER);
});

test("owner edits name and description and sees them in the header after a reload", async ({ page }, info) => {
  const group = await createAndOpen(page, { name: "Old Name", mode: "link" });
  await tabs(page).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/settings`);

  // By role, so only visible fields match: the Create page left earlier can still be in the DOM, hidden.
  await page.getByRole("textbox", { name: "Group name", exact: true }).fill("Maths Circle 2026");
  await page.getByRole("textbox", { name: "Description (optional)" }).fill("Notes and papers for the 2026 batch.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  await page.reload();
  const header = page.getByTestId("group-header");
  await expect(header.getByRole("heading", { level: 1 })).toHaveText("Maths Circle 2026");
  await expect(header).toContainText("Notes and papers for the 2026 batch.");
  if (isPhone(info.project.name)) {
    await expect(page.getByRole("banner")).toContainText("Maths Circle 2026");
  } else {
    await expect(page.locator("aside").getByRole("link", { name: "Maths Circle 2026" })).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByText("Old Name", { exact: true })).toHaveCount(0);
});

test("owner switches to link mode and back, new password shown once", async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Physics Lab", mode: "password" });
  await page.goto(`/groups/${group.id}/settings`);
  await expect(page.getByRole("radio", { name: /Link and password/ })).toBeChecked();

  // To link only: saved, no password anywhere, and the share text no longer asks for one.
  await page.getByRole("radio", { name: /Link only/ }).check();
  await expect(page.getByLabel("New group password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save join settings" }).click();
  await expect(page.getByText("Saved. Anyone with the link or the code can join.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Link only/ })).toBeChecked();
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute(
    "href",
    `https://wa.me/?text=${encodeURIComponent(`Join Physics Lab on study-share: ${group.link}`)}`,
  );

  // Back to a password: the new one is shown once, with a Copy button.
  await page.getByRole("radio", { name: /Link and password/ }).check();
  await page.getByLabel("New group password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save join settings" }).click();
  await expect(page.getByTestId("revealed-password")).toHaveText(NEW_PASSWORD);
  await expect(page.getByRole("button", { name: "Copy password" })).toBeVisible();
  await expect(page.getByText("Send the password separately from the link.")).toBeVisible();

  // Never in an address, a link or a cookie.
  expect(page.url()).not.toContain(NEW_PASSWORD);
  const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  for (const href of hrefs) expect(decodeURIComponent(href)).not.toContain(NEW_PASSWORD);
  for (const cookie of await page.context().cookies()) expect(decodeURIComponent(cookie.value)).not.toContain(NEW_PASSWORD);

  // Away to another tab and back, then a reload: gone.
  await tabs(page).getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/members`);
  await tabs(page).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(`/groups/${group.id}/settings`);
  await expect(page.getByRole("button", { name: "Save join settings" })).toBeVisible();
  await expect(page.getByText(NEW_PASSWORD)).toHaveCount(0);
  await expect(page.getByLabel("New group password", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Link and password/ })).toBeChecked();
  await expect(page.getByText(NEW_PASSWORD)).toHaveCount(0);

  // The new password is the one that lets people in.
  const friend = await newPerson(browser, info, page, MEMBER);
  expect((await joinWith(friend, group.code, GROUP_PASSWORD)).fieldErrors?.password).toBe(GROUP_MESSAGES.wrongPassword);
  expect((await joinWith(friend, group.code, NEW_PASSWORD)).ok).toBe(true);
});

test("reset link: the old link says no longer valid for a new visitor and the new one works", async ({ page, browser }, info) => {
  const group = await createAndOpen(page, { name: "Reset Group", mode: "link" });
  await tabs(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("invite-link")).toHaveText(group.link);
  await expect(page.getByTestId("invite-code")).toHaveText(group.code);

  await page.getByRole("button", { name: "Reset link" }).click();
  const confirm = page.getByRole("dialog", { name: "Reset the invite link?" });
  await expect(confirm).toContainText("The old link and code stop working immediately.");
  await confirm.getByRole("button", { name: "Reset link" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId("invite-link")).not.toHaveText(group.link);
  await expect(page.getByTestId("invite-code")).not.toHaveText(group.code);
  const newLink = (await page.getByTestId("invite-link").textContent())?.trim() ?? "";
  expect(newLink).toMatch(/^http:\/\/localhost:\d+\/invite\/\S+$/);

  // A new visitor opening the old link or the old code on the invite page: the standard message,
  // and no way to join from it.
  const visitor = await newPerson(browser, info, page, "Meera Iyer");
  for (const key of [group.token, group.code]) {
    await visitor.goto(`/invite/${key}`);
    await expect(visitor.getByText(GROUP_MESSAGES.invalidInvite)).toBeVisible();
    await expect(visitor.getByRole("button", { name: "Join", exact: true })).toHaveCount(0);
    await expect(visitor.getByText("Reset Group")).toHaveCount(0);
  }
  await visitor.goto(new URL(newLink).pathname);
  await visitor.getByRole("button", { name: "Join", exact: true }).click();
  await expect(visitor).toHaveURL(`/groups/${group.id}`);
  await expect(visitor.getByRole("heading", { level: 1, name: "Reset Group" })).toBeVisible();
});

test("the group tabs are a fixed bottom bar with safe-area padding on phones (nothing sits under it) and a plain top row on desktop, with no sideways scroll", async ({ page }, info) => {
  const name = "తెలుగు సాహిత్యం అధ్యయన బృందం 📚 Thermodynamics";
  const group = await createAndOpen(page, { name, mode: "link" });
  const nav = tabs(page);

  for (const path of ["", "/members", "/settings"]) {
    await page.goto(`/groups/${group.id}${path}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    for (const link of await nav.getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    if (isPhone(info.project.name)) {
      // Fixed to the bottom edge, padded by the safe area, and nothing in the page ends up under it.
      expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
      expect(await nav.evaluate((el) => el.style.paddingBottom)).toContain("safe-area-inset-bottom");
      const viewport = page.viewportSize()!;
      const navBox = (await nav.boundingBox())!;
      expect(Math.round(navBox.y + navBox.height)).toBe(viewport.height);
      expect(Math.round(navBox.width)).toBe(viewport.width);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lastBottom = await page.getByTestId("group-content").evaluate((el) => {
        const items = Array.from(el.querySelectorAll("*")).filter((node) => node.getBoundingClientRect().height > 0);
        return Math.max(...items.map((node) => node.getBoundingClientRect().bottom));
      });
      expect(lastBottom).toBeLessThanOrEqual(navBox.y);
    } else {
      // Desktop: a tab row at the top of the group, not fixed.
      expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("static");
      const navBox = (await nav.boundingBox())!;
      const contentBox = (await page.getByTestId("group-content").boundingBox())!;
      expect(navBox.y).toBeLessThan(contentBox.y);
    }

    // The long name is cut off in the heading rather than pushing the page wide.
    const heading = page.getByRole("heading", { level: 1, name });
    expect(await heading.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    await auditPage(page);
  }
});
