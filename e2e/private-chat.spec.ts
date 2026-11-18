import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { DIRECT_CHAT_MESSAGES } from "../src/shared/direct-chat-messages";
import { auditPage } from "./audit";
import {
  createGroupThroughForm,
  isolateRateLimits,
  joinWith,
  newPersonContext,
  saveDarkThemeBeforeLoad,
  sidewaysOverflow,
  signUpAndConfirm,
} from "./helpers";

/*
  Slice 6, private chats between two members, as real people in real browsers (fake services mode).
  The owner is the test's own browser; everyone else is in a context of their own, sized like this
  project's device, and is put into the group with the test-only join route. A private chat is
  opened from the Members tab ("Message <name>"). Like the group chat there is no realtime service:
  each browser asks for news every 2.5 seconds, so every wait for the other person's screen allows
  for that, and a deleted message is noticed by the "newest page" look (at most every sixth poll).
  Never resets the shared fake store.
*/

const OWNER = "Asha Rao";
const RAVI = "Ravi Kumar";
const MEERA = "Meera Iyer";
const DEV = "Dev Patel";
const NOT_FOUND_TEXT = "This page could not be found.";
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CHAT_URL = /\/groups\/[0-9a-f-]{36}\/chat\/private\/[0-9a-f-]{36}$/;
/** More than one poll interval, less than the test timeout. */
const POLLED = { timeout: 10_000 };
/** Deletions are noticed by the newest-page look, at most six polls (15 s) apart. */
const DELETED = { timeout: 25_000 };

let extraContexts: BrowserContext[] = [];

test.beforeEach(async ({ page }) => {
  extraContexts = [];
  await isolateRateLimits(page);
});

test.afterEach(async () => {
  for (const context of extraContexts) await context.close();
});

const isPhone = (info: TestInfo) => info.project.name.startsWith("phone");

const tabs = (page: Page) => page.getByRole("navigation", { name: "Group sections" });
const chatSwitch = (page: Page) => page.getByRole("navigation", { name: "Chat type" });
const memberList = (page: Page) => page.getByRole("list", { name: "Members" });
const memberRow = (page: Page, name: string) => memberList(page).getByRole("listitem").filter({ hasText: name });
const privateList = (page: Page) => page.getByRole("list", { name: "Private chats" });
const privateRow = (page: Page, name: string) => privateList(page).getByRole("listitem").filter({ hasText: name });
const log = (page: Page) => page.getByRole("log", { name: "Messages" });
const messages = (page: Page) => log(page).getByTestId("chat-message");
const message = (page: Page, text: string | RegExp) => messages(page).filter({ hasText: text });
const box = (page: Page) => page.getByLabel("Write a message", { exact: true });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send", exact: true });
const dot = (scope: ReturnType<typeof tabs>) => scope.getByRole("img", { name: "New private message" });
const readOnlyNote = (name: string) => DIRECT_CHAT_MESSAGES.readOnlyNote(name);

type Group = Awaited<ReturnType<typeof createGroupThroughForm>>;

async function setUp(page: Page, groupName: string) {
  await signUpAndConfirm(page, { name: OWNER });
  return createGroupThroughForm(page, { name: groupName, mode: "link", fromHome: true });
}

async function addMember(page: Page, browser: Browser, info: TestInfo, group: { code: string }, name: string): Promise<Page> {
  const person = await newPersonContext(browser, info, page, name);
  extraContexts.push(person.context);
  expect((await joinWith(person.page, group.code)).ok).toBe(true);
  return person.page;
}

/** Taps "Message <name>" on the Members tab and returns the conversation's id. */
async function messageMember(page: Page, group: Group, name: string): Promise<string> {
  await page.goto(`${group.path}/members`);
  await page.getByRole("button", { name: `Message ${name}`, exact: true }).click();
  await expect(page).toHaveURL(CHAT_URL);
  await expect(box(page)).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

/** Types the text and sends it the way this device does: Enter on a computer, the Send button on a phone. */
async function say(page: Page, info: TestInfo, text: string) {
  await box(page).fill(text);
  if (isPhone(info)) await sendButton(page).click();
  else await box(page).press("Enter");
  await expect(box(page)).toHaveValue("");
}

/**
 * A GET with the person's cookies. The server closes an idle connection after a few seconds and a
 * request that reuses it at that moment can be reset, so a reset is tried once more (a real failure fails twice).
 */
async function get(who: { request: APIRequestContext }, url: string, options?: { maxRedirects?: number }) {
  try {
    return await who.request.get(url, options);
  } catch {
    return who.request.get(url, options);
  }
}

const bodyText = (page: Page, text: string | RegExp) => message(page, text).locator("p").evaluate((p) => p.textContent);

async function notFoundAt(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
  return response?.status();
}

/** The chat key in a member's row on the Members tab, as that person's page shows it. */
const chatKeyOf = (page: Page, name: string) => memberRow(page, name).locator('input[name="chatKey"]').getAttribute("value");

test("Message opens a private chat; it is hidden until someone writes, then shows up with unread dots that clear once read", async ({ page, browser }, info) => {
  const group = await setUp(page, "Private Start");
  const ravi = await addMember(page, browser, info, group, RAVI);
  await addMember(page, browser, info, group, MEERA);

  // Members: a Message button on every OTHER member's row, at least 44px, with the person's name; none on your own row.
  await ravi.goto(`${group.path}/members`);
  await expect(memberList(ravi).getByRole("listitem")).toHaveCount(3);
  await expect(ravi.getByRole("button", { name: /^Message / })).toHaveCount(2);
  await expect(ravi.getByRole("button", { name: `Message ${RAVI}` })).toHaveCount(0);
  for (const name of [OWNER, MEERA]) {
    const button = ravi.getByRole("button", { name: `Message ${name}`, exact: true });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expect(dot(memberList(ravi))).toHaveCount(0);

  // Tapping opens the conversation: the person's name as the title, a way back, an empty chat.
  await ravi.getByRole("button", { name: `Message ${OWNER}`, exact: true }).click();
  await expect(ravi).toHaveURL(CHAT_URL);
  await expect(ravi.getByRole("heading", { level: 2, name: OWNER })).toBeVisible();
  await expect(ravi.getByRole("link", { name: DIRECT_CHAT_MESSAGES.backToList })).toHaveAttribute("href", `${group.path}/chat/private`);
  await expect(ravi.getByText(`No messages yet. Say hello to ${OWNER}.`)).toBeVisible();
  await expect(tabs(ravi).getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "true");

  // Nobody has written yet: the owner's Private list is empty, and so is Ravi's own.
  await page.goto(`${group.path}/chat/private`);
  await expect(page.getByText(DIRECT_CHAT_MESSAGES.emptyList)).toBeVisible();
  await expect(chatSwitch(page).getByRole("link", { name: "Private" })).toHaveAttribute("aria-current", "page");
  await expect(chatSwitch(page).getByRole("link", { name: "Group" })).not.toHaveAttribute("aria-current", /.+/);
  await expect(dot(tabs(page))).toHaveCount(0);
  await ravi.goto(`${group.path}/chat/private`);
  await expect(ravi.getByText(DIRECT_CHAT_MESSAGES.emptyList)).toBeVisible();

  // Ravi writes. The owner never reloads: the Private list polls, so the row, its preview and the dots appear.
  await ravi.goBack();
  await expect(box(ravi)).toBeVisible();
  await say(ravi, info, "Do you have last year's paper?\nPlease");
  await expect(message(ravi, "last year's paper")).toHaveAttribute("data-status", "sent");
  await expect(privateRow(page, RAVI)).toBeVisible(POLLED);
  await expect(privateRow(page, RAVI)).toContainText("Do you have last year's paper? Please");
  await expect(dot(privateRow(page, RAVI))).toBeVisible();
  await expect(dot(tabs(page))).toBeVisible();
  await expect(dot(chatSwitch(page))).toBeVisible();
  // The time is worked out in the browser: a relative phrase, never a raw date.
  await expect(privateRow(page, RAVI).locator("time")).toHaveText(/^(just now|\d+ min ago|\d+ h ago)$/);

  // The Members tab shows the dot on Ravi's row only.
  await tabs(page).getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`${group.path}/members`);
  await expect(dot(memberRow(page, RAVI))).toBeVisible();
  await expect(dot(memberRow(page, MEERA))).toHaveCount(0);
  await expect(dot(memberList(page))).toHaveCount(1);
  await expect(dot(tabs(page))).toBeVisible();

  // Reading it clears every dot, here and after a reload.
  await page.getByRole("button", { name: `Message ${RAVI}`, exact: true }).click();
  await expect(page).toHaveURL(CHAT_URL);
  await expect(message(page, "last year's paper")).toHaveAttribute("data-mine", "false");
  await expect(message(page, "last year's paper")).toContainText(RAVI);
  expect(await bodyText(page, "last year's paper")).toBe("Do you have last year's paper?\nPlease");
  await expect(dot(tabs(page))).toHaveCount(0, POLLED);
  await page.getByRole("link", { name: DIRECT_CHAT_MESSAGES.backToList }).click();
  await expect(page).toHaveURL(`${group.path}/chat/private`);
  await expect(privateRow(page, RAVI)).toBeVisible();
  await expect(dot(privateList(page))).toHaveCount(0, POLLED);
  await expect(dot(tabs(page))).toHaveCount(0);
  await expect(dot(chatSwitch(page))).toHaveCount(0);
  await page.goto(`${group.path}/members`);
  await expect(dot(page.locator("body"))).toHaveCount(0);

  // The row opens the conversation again, with the message there.
  await page.goto(`${group.path}/chat/private`);
  await privateRow(page, RAVI).getByRole("link").click();
  await expect(page).toHaveURL(CHAT_URL);
  await expect(message(page, "last year's paper")).toBeVisible();

  // The Group tab of the Chat area is the group chat, and has nothing of this in it.
  await page.goto(`${group.path}/chat`);
  await expect(chatSwitch(page).getByRole("link", { name: "Group" })).toHaveAttribute("aria-current", "page");
  await expect(chatSwitch(page).getByRole("link", { name: "Private" })).not.toHaveAttribute("aria-current", /.+/);
  await expect(page.getByText("No messages yet. Say hello to the group.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("last year's paper");
  await chatSwitch(page).getByRole("link", { name: "Private" }).click();
  await expect(page).toHaveURL(`${group.path}/chat/private`);
});

test("people talk privately: replies arrive within the polling window, line breaks and the 2000 limit work, and only your own message can be deleted", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Private Talk");
  const ravi = await addMember(page, browser, info, group, RAVI);
  await messageMember(ravi, group, OWNER);
  await say(ravi, info, "Hi Asha");

  await page.goto(`${group.path}/chat/private`);
  await privateRow(page, RAVI).getByRole("link").click();
  await expect(page).toHaveURL(CHAT_URL);
  await expect(message(page, "Hi Asha")).toBeVisible();
  await expect(box(page)).toHaveAttribute("maxlength", "2000");

  await say(page, info, "Hello Ravi");
  await expect(message(page, "Hello Ravi")).toHaveAttribute("data-mine", "true");
  await expect(message(page, "Hello Ravi").locator("time")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(message(ravi, "Hello Ravi")).toBeVisible(POLLED);
  await expect(message(ravi, "Hello Ravi")).toHaveAttribute("data-mine", "false");

  // Line breaks are kept and reach the other person as they were written.
  await box(page).click();
  await box(page).pressSequentially("one");
  await box(page).press("Shift+Enter");
  await box(page).pressSequentially("two");
  if (isPhone(info)) await sendButton(page).click();
  else await box(page).press("Enter");
  await expect(message(ravi, "one")).toBeVisible(POLLED);
  expect(await bodyText(ravi, /^one/)).toBe("one\ntwo");

  // The 2000-character limit, and a long text wraps.
  await box(ravi).fill("w".repeat(2001));
  expect((await box(ravi).inputValue()).length).toBe(2000);
  await expect(ravi.getByText("2000/2000")).toBeVisible();
  if (isPhone(info)) await sendButton(ravi).click();
  else await box(ravi).press("Enter");
  await expect(message(ravi, /w{2000}/)).toBeVisible();
  await expect(message(page, /w{2000}/)).toBeVisible(POLLED);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  expect(await sidewaysOverflow(ravi)).toBeLessThanOrEqual(0);

  // Delete: own messages only, even the group's owner cannot delete the other person's.
  await expect(message(page, "Hi Asha").getByRole("button")).toHaveCount(0);
  await expect(message(page, /w{2000}/).getByRole("button")).toHaveCount(0);
  await expect(message(page, "Hello Ravi").getByRole("button", { name: /^Delete message/ })).toBeVisible();
  await expect(message(ravi, "Hello Ravi").getByRole("button")).toHaveCount(0);
  await expect(message(ravi, "Hi Asha").getByRole("button", { name: /^Delete message/ })).toBeVisible();

  await message(ravi, "Hi Asha").getByRole("button", { name: /^Delete message/ }).click();
  const sheet = ravi.getByRole("dialog", { name: "Delete this message?" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("It disappears for both of you");
  await expect(sheet).not.toContainText("everyone in the group");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await expect(message(ravi, "Hi Asha")).toBeVisible();
  await message(ravi, "Hi Asha").getByRole("button", { name: /^Delete message/ }).click();
  await ravi.getByRole("dialog", { name: "Delete this message?" }).getByRole("button", { name: "Yes, delete", exact: true }).click();
  await expect(ravi.getByRole("dialog")).toHaveCount(0);
  await expect(message(ravi, "Hi Asha")).toHaveCount(0);
  await expect(message(page, "Hi Asha")).toHaveCount(0, DELETED);
  await ravi.reload();
  await expect(message(ravi, "Hi Asha")).toHaveCount(0);
  await expect(message(ravi, "Hello Ravi")).toBeVisible();
});

test("only the two people can open, poll or see a private chat: not the owner, not another member, not another group's address; hostile codes are refused", async ({ page, browser }, info) => {
  const group = await setUp(page, "Private Walls");
  const ravi = await addMember(page, browser, info, group, RAVI);
  const meera = await addMember(page, browser, info, group, MEERA);
  const dev = await addMember(page, browser, info, group, DEV);

  const chatId = await messageMember(ravi, group, MEERA);
  await say(ravi, info, "Secret revision plan");
  await meera.goto(`${group.path}/chat/private`);
  await expect(privateRow(meera, RAVI)).toBeVisible();
  await privateRow(meera, RAVI).getByRole("link").click();
  await expect(message(meera, "Secret revision plan")).toBeVisible();

  const conversation = `${group.path}/chat/private/${chatId}`;
  const poll = `${conversation}/messages`;
  expect((await get(ravi, poll)).status()).toBe(200);
  expect((await get(meera, poll)).status()).toBe(200);

  // The same page (and status) as for a conversation that does not exist at all.
  const madeUpStatus = await notFoundAt(page, `${group.path}/chat/private/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e`);

  // The owner and another member: the same plain not-found page and a bare 404 on the polling address; and nothing in their list.
  for (const outsider of [page, dev]) {
    expect(await notFoundAt(outsider, conversation)).toBe(madeUpStatus);
    await expect(outsider.locator("body")).not.toContainText("Secret revision plan");
    await expect(outsider.locator("body")).not.toContainText(MEERA + " is");
    expect((await get(outsider, poll)).status()).toBe(404);
    expect((await get(outsider, `${poll}?after=abc`)).status()).toBe(404);
    expect((await get(outsider, `${group.path}/chat/private/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/messages`)).status()).toBe(404);
    expect((await get(outsider, `${group.path}/chat/private/not-an-id/messages`)).status()).toBe(404);
    await outsider.goto(`${group.path}/chat/private`);
    await expect(outsider.getByText(DIRECT_CHAT_MESSAGES.emptyList)).toBeVisible();
    await expect(outsider.locator("body")).not.toContainText("Secret revision plan");
    const summary = await get(outsider, `${group.path}/chat/private/summary`);
    expect(summary.status()).toBe(200);
    expect(await summary.json()).toEqual({ chats: [], unread: { any: false, fromChatKeys: [] } });
    await outsider.goto(`${group.path}/members`);
    await expect(dot(outsider.locator("body"))).toHaveCount(0);
    await outsider.goto(`${group.path}/chat`);
    await expect(dot(tabs(outsider))).toHaveCount(0);
  }
  expect(await notFoundAt(page, `${group.path}/chat/private/not-an-id`)).toBe(madeUpStatus);

  // A stranger and a signed-out visitor.
  const stranger = await newPersonContext(browser, info, page, "Zed Stranger");
  extraContexts.push(stranger.context);
  expect(await notFoundAt(stranger.page, conversation)).toBe(madeUpStatus);
  expect((await get(stranger.page, poll)).status()).toBe(404);
  expect((await get(stranger.page, `${group.path}/chat/private/summary`)).status()).toBe(404);
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  extraContexts.push(visitor);
  for (const path of [poll, `${group.path}/chat/private/summary`]) {
    const answer = await get(visitor, path, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(answer.status());
    expect(answer.headers()["location"]).toContain("/login");
  }

  // Another group's chat under this group's address: Ravi and Meera are in both groups, and the chat is theirs, but it belongs to the other group.
  await page.goto("/groups/new");
  const other = await createGroupThroughForm(page, { name: "Private Walls Two", mode: "link" });
  for (const person of [ravi, meera]) expect((await joinWith(person, other.code)).ok).toBe(true);
  const otherChatId = await messageMember(ravi, other, MEERA);
  await say(ravi, info, "Other group words");
  expect(otherChatId).not.toBe(chatId);
  expect((await get(ravi, `${other.path}/chat/private/${otherChatId}/messages`)).status()).toBe(200);
  for (const person of [ravi, meera]) {
    expect(await notFoundAt(person, `${group.path}/chat/private/${otherChatId}`)).toBe(madeUpStatus);
    expect((await get(person, `${group.path}/chat/private/${otherChatId}/messages`)).status()).toBe(404);
    await expect(person.locator("body")).not.toContainText("Other group words");
  }
  // And this group's chat under the other group's address.
  expect((await get(ravi, `${other.path}/chat/private/${chatId}/messages`)).status()).toBe(404);

  // Hostile codes: a made-up one, one from another group, and the person's own code (as the owner's page shows it) all say the same and open nothing.
  await ravi.goto(`${other.path}/members`);
  const otherGroupKey = await chatKeyOf(ravi, MEERA);
  await page.goto(`${group.path}/members`);
  const ravisOwnKey = await chatKeyOf(page, RAVI);
  expect(otherGroupKey).toBeTruthy();
  expect(ravisOwnKey).toBeTruthy();
  await ravi.goto(`${group.path}/members`);
  const url = ravi.url();
  for (const hostile of ["not-a-key", "", "A".repeat(43), otherGroupKey ?? "", ravisOwnKey ?? ""]) {
    await memberRow(ravi, MEERA).locator('input[name="chatKey"]').evaluate((input, value) => {
      (input as HTMLInputElement).value = value;
    }, hostile);
    await memberRow(ravi, MEERA).getByRole("button", { name: `Message ${MEERA}` }).click();
    await expect(ravi.getByText(DIRECT_CHAT_MESSAGES.notFound)).toBeVisible();
    await expect(ravi).toHaveURL(url);
    // The next try starts from a clean row (a reload puts the real code back).
    await ravi.reload();
  }
  // The real code still works after all that.
  await ravi.getByRole("button", { name: `Message ${MEERA}`, exact: true }).click();
  await expect(ravi).toHaveURL(`${conversation}`);
  await expect(message(ravi, "Secret revision plan")).toBeVisible();

  // Plain members never get another member's account id: not in the Members page, the list's polling or the conversation.
  const uuids = (html: string) => new Set(html.match(UUID_G)?.map((id) => id.toLowerCase()) ?? []);
  const ownerHtml = await (await get(page, `${group.path}/members`)).text();
  const baseline = uuids(await (await get(dev, "/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e")).text());
  baseline.add(group.id);
  // The sidebar lists every group the person is in, so the other group's address is on the page too.
  baseline.add(other.id);
  const accountIds = [...uuids(ownerHtml)].filter((id) => !baseline.has(id));
  expect(accountIds.length).toBeGreaterThanOrEqual(4);
  await ravi.goto(`${group.path}/members`);
  await expect(ravi.getByRole("button", { name: `Message ${MEERA}` })).toBeVisible();
  const shown = await ravi.content();
  const fetched = await (await get(ravi, `${group.path}/members`)).text();
  for (const html of [shown, fetched]) {
    expect(html).toContain(MEERA);
    expect([...uuids(html)].filter((id) => !baseline.has(id))).toEqual([]);
    for (const id of accountIds) expect(html.toLowerCase()).not.toContain(id);
  }
  for (const body of [await (await get(ravi, poll)).text(), await (await get(ravi, `${group.path}/chat/private/summary`)).text()]) {
    for (const id of accountIds) expect(body.toLowerCase()).not.toContain(id);
  }
  const conversationHtml = await (await get(meera, conversation)).text();
  for (const id of accountIds) expect(conversationHtml.toLowerCase()).not.toContain(id);
});

test("when the other person is removed the stayer can read but not reply, and the removed person gets not-found", async ({ page, browser }, info) => {
  const group = await setUp(page, "Private Removal");
  const ravi = await addMember(page, browser, info, group, RAVI);
  const meera = await addMember(page, browser, info, group, MEERA);
  const chatId = await messageMember(ravi, group, MEERA);
  await say(ravi, info, "Before the removal");
  await meera.goto(`${group.path}/chat/private/${chatId}`);
  await expect(message(meera, "Before the removal")).toBeVisible();
  await say(meera, info, "Meera's answer");
  await expect(message(ravi, "Meera's answer")).toBeVisible(POLLED);
  await expect(box(meera)).toBeVisible();

  // The owner removes Ravi while Meera has the conversation open: it turns read-only at the next poll.
  await page.goto(`${group.path}/members`);
  await page.getByRole("button", { name: `Remove ${RAVI}` }).click();
  await page.getByRole("dialog", { name: `Remove ${RAVI}?` }).getByRole("button", { name: `Yes, remove ${RAVI}`, exact: true }).click();
  await expect(memberList(page).getByRole("listitem")).toHaveCount(2);

  await expect(meera.getByText(readOnlyNote(RAVI))).toBeVisible(POLLED);
  await expect(box(meera)).toHaveCount(0);
  await expect(sendButton(meera)).toHaveCount(0);
  await expect(message(meera, "Before the removal")).toBeVisible();
  await expect(message(meera, "Meera's answer")).toBeVisible();
  await expect(meera.getByRole("button", { name: /^Delete message/ })).toHaveCount(0);

  // After a reload the server renders it read-only too, and the list says who left.
  await meera.reload();
  await expect(meera.getByText(readOnlyNote(RAVI))).toBeVisible();
  await expect(box(meera)).toHaveCount(0);
  await expect(meera.getByRole("button", { name: /^Delete message/ })).toHaveCount(0);
  await meera.goto(`${group.path}/chat/private`);
  await expect(privateRow(meera, RAVI)).toContainText(DIRECT_CHAT_MESSAGES.leftTag);
  await privateRow(meera, RAVI).getByRole("link").click();
  await expect(meera.getByText(readOnlyNote(RAVI))).toBeVisible();
  await auditPage(meera);

  // Ravi no longer sees the group, let alone the chat: the same page as for any stranger, and a 404 from the poll.
  await expect(ravi.getByText("You can no longer see this chat")).toBeVisible(POLLED);
  await notFoundAt(ravi, `${group.path}/chat/private/${chatId}`);
  expect((await get(ravi, `${group.path}/chat/private/${chatId}/messages`)).status()).toBe(404);
  // Nothing new can be added by hand either: the Members list has no Message button for a person who is gone.
  await meera.goto(`${group.path}/members`);
  await expect(meera.getByRole("button", { name: `Message ${RAVI}` })).toHaveCount(0);
});

test("a member who leaves loses the chat, the one who stays reads it, and rejoining brings the same chat back", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Private Rejoin");
  const ravi = await addMember(page, browser, info, group, RAVI);
  const meera = await addMember(page, browser, info, group, MEERA);
  const chatId = await messageMember(ravi, group, MEERA);
  await say(ravi, info, "Before leaving");
  await meera.goto(`${group.path}/chat/private/${chatId}`);
  await expect(message(meera, "Before leaving")).toBeVisible();

  // Meera leaves.
  await meera.goto(`${group.path}/members`);
  await meera.getByRole("button", { name: "Leave group" }).click();
  await meera.getByRole("dialog", { name: "Leave Private Rejoin?" }).getByRole("button", { name: "Leave group" }).click();
  await expect(meera).toHaveURL("/");
  await notFoundAt(meera, `${group.path}/chat/private/${chatId}`);
  expect((await get(meera, `${group.path}/chat/private/${chatId}/messages`)).status()).toBe(404);

  // Ravi, who stays, reads it but cannot reply.
  await expect(ravi.getByText(readOnlyNote(MEERA))).toBeVisible(POLLED);
  await expect(box(ravi)).toHaveCount(0);
  await expect(message(ravi, "Before leaving")).toBeVisible();
  // A fresh page while she is gone: the server says nothing of Ravi's is deletable now.
  await ravi.reload();
  await expect(ravi.getByText(readOnlyNote(MEERA))).toBeVisible();
  await expect(message(ravi, "Before leaving")).toBeVisible();
  await expect(ravi.getByRole("button", { name: /^Delete message/ })).toHaveCount(0);

  // Meera joins again with the same account: the same conversation, and Ravi can reply again.
  expect((await joinWith(meera, group.code)).ok).toBe(true);
  await meera.goto(`${group.path}/chat/private`);
  await expect(privateRow(meera, RAVI)).toBeVisible();
  await expect(privateRow(meera, RAVI)).not.toContainText(DIRECT_CHAT_MESSAGES.leftTag);
  await privateRow(meera, RAVI).getByRole("link").click();
  await expect(meera).toHaveURL(`${group.path}/chat/private/${chatId}`);
  await expect(message(meera, "Before leaving")).toBeVisible();
  await expect(box(meera)).toBeVisible();
  await expect(ravi.getByText(readOnlyNote(MEERA))).toHaveCount(0, POLLED);
  await expect(box(ravi)).toBeVisible();
  // His own earlier message can be deleted again at once, without a reload (and Meera's never can).
  await expect(message(ravi, "Before leaving").getByRole("button", { name: /^Delete message/ })).toBeVisible();
  await expect(ravi.getByRole("button", { name: /^Delete message/ })).toHaveCount(1);
  await say(ravi, info, "Welcome back");
  await expect(message(meera, "Welcome back")).toBeVisible(POLLED);
  await say(meera, info, "Thanks");
  await expect(message(ravi, "Thanks")).toBeVisible(POLLED);
  // Still one conversation between them.
  await ravi.goto(`${group.path}/chat/private`);
  await expect(privateList(ravi).getByRole("listitem")).toHaveCount(1);
});

test("the Chat area, the Private list, a conversation and the Message buttons fit a phone and meet the quality bar", async ({ page, browser }, info) => {
  const group = await setUp(page, "Private Layout");
  const ravi = await addMember(page, browser, info, group, RAVI);
  await messageMember(ravi, group, OWNER);
  const longName = `Wordy-${"x".repeat(60)}`;
  await say(ravi, info, `${longName}\nsecond line`);
  await say(ravi, info, "A short one");

  // The Members tab with a dot and Message buttons.
  await page.goto(`${group.path}/members`);
  await expect(dot(memberRow(page, RAVI))).toBeVisible(POLLED);
  await auditPage(page);

  // The group chat with its switch.
  await page.goto(`${group.path}/chat`);
  await expect(chatSwitch(page).getByRole("link", { name: "Private" })).toBeVisible();
  for (const link of await chatSwitch(page).getByRole("link").all()) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await auditPage(page);

  // The Private list, in both themes.
  await page.goto(`${group.path}/chat/private`);
  await expect(privateRow(page, RAVI)).toBeVisible();
  await auditPage(page);
  await saveDarkThemeBeforeLoad(page);
  await page.reload();
  await expect(privateRow(page, RAVI)).toBeVisible();
  await auditPage(page);

  // A conversation: composer above the tab bar, the page itself does not scroll.
  await privateRow(page, RAVI).getByRole("link").click();
  await expect(message(page, "A short one")).toBeVisible();
  await expect(message(page, longName)).toBeVisible();
  await auditPage(page);
  const geometry = await page.evaluate(() => {
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const nav = document.querySelector('nav[aria-label="Group sections"]');
    return {
      height: window.visualViewport?.height ?? window.innerHeight,
      width: window.visualViewport?.width ?? window.innerWidth,
      textarea: rect(document.querySelector("textarea")),
      send: rect(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Send") ?? null),
      nav: rect(nav),
      navFixed: nav ? getComputedStyle(nav).position === "fixed" : false,
      scrollable: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  });
  if (!geometry.textarea || !geometry.send || !geometry.nav) throw new Error("composer or tab bar missing");
  expect(geometry.send.right).toBeLessThanOrEqual(geometry.width + 0.5);
  expect(geometry.send.height).toBeGreaterThanOrEqual(44);
  expect(geometry.send.bottom).toBeLessThanOrEqual(geometry.height);
  if (geometry.navFixed) expect(geometry.send.bottom).toBeLessThanOrEqual(geometry.nav.top + 1);
  expect(geometry.scrollable).toBeLessThanOrEqual(1);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  // The back link is a real target.
  const back = page.getByRole("link", { name: DIRECT_CHAT_MESSAGES.backToList });
  expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  if (isPhone(info)) expect(page.viewportSize()?.width).toBeLessThanOrEqual(412);
});

test("a read-only conversation fits a phone and meets the quality bar", async ({ page, browser }, info) => {
  const group = await setUp(page, "Private Quiet");
  const ravi = await addMember(page, browser, info, group, RAVI);
  const chatId = await messageMember(ravi, group, OWNER);
  await say(ravi, info, "Last words");
  await page.goto(`${group.path}/members`);
  await page.getByRole("button", { name: `Remove ${RAVI}` }).click();
  await page.getByRole("dialog", { name: `Remove ${RAVI}?` }).getByRole("button", { name: `Yes, remove ${RAVI}`, exact: true }).click();
  await expect(memberList(page).getByRole("listitem")).toHaveCount(1);
  await page.goto(`${group.path}/chat/private/${chatId}`);
  await expect(page.getByText(readOnlyNote(RAVI))).toBeVisible();
  await expect(message(page, "Last words")).toBeVisible();
  await expect(box(page)).toHaveCount(0);
  await auditPage(page);
  await page.goto(`${group.path}/chat/private`);
  await expect(privateRow(page, RAVI)).toContainText(DIRECT_CHAT_MESSAGES.leftTag);
  await auditPage(page);
});
