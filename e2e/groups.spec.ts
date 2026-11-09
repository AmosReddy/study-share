import { expect, test, type Page } from "@playwright/test";
import { auditPage } from "./audit";
import { isolateRateLimits, sidewaysOverflow, signUpAndConfirm } from "./helpers";

/*
  Groups, step 1: the home list, the Create a group page and the invite card that follows it.
  Every test signs up a fresh person through the real flow (fake services mode). The group page
  itself (/groups/<id>) and /join arrive in later tasks, so nothing here opens them.
*/

const OWNER = "Asha Rao";
const GROUP_PASSWORD = "maths-key-42";

test.beforeEach(async ({ page, context }) => {
  await isolateRateLimits(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpAndConfirm(page, { name: OWNER });
});

const isPhone = (name: string) => name.startsWith("phone");
const main = (page: Page) => page.getByRole("main");

/** Opens the create page from the home link and fills it in. Leaves the form unsent. */
async function fillCreateForm(
  page: Page,
  { name, mode, password }: { name: string; mode: "password" | "link"; password?: string },
) {
  await page.goto("/");
  await main(page).getByRole("link", { name: "Create a group" }).click();
  await expect(page).toHaveURL("/groups/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
  await page.getByLabel("Group name", { exact: true }).fill(name);
  if (mode === "link") {
    await page.getByRole("radio", { name: /Link only/ }).check();
  } else {
    await expect(page.getByRole("radio", { name: /Link and password/ })).toBeChecked();
    await page.getByLabel("Group password", { exact: true }).fill(password ?? GROUP_PASSWORD);
  }
}

async function createGroup(page: Page, options: { name: string; mode: "password" | "link"; password?: string }) {
  await fillCreateForm(page, options);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Group created" })).toBeVisible();
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

  // The password is in no link, no address and no cookie.
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
  await expect(page).toHaveURL("/groups/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
  await expect(page.getByText(GROUP_PASSWORD)).toHaveCount(0);
  await expect(page.getByLabel("Group password", { exact: true })).toHaveValue("");

  // And opened afresh.
  await page.goto("/groups/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create a group" })).toBeVisible();
  await expect(page.getByText(GROUP_PASSWORD)).toHaveCount(0);
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
