import { expect, test, type Browser, type BrowserContext, type Page, type Request, type TestInfo } from "@playwright/test";
import { CHAT_MESSAGES } from "../src/shared/chat-messages";
import { auditPage } from "./audit";
import { createGroupThroughForm, isolateRateLimits, joinWith, newPersonContext, sidewaysOverflow, signUpAndConfirm } from "./helpers";

/*
  Slice 3, group chat, as real people in real browsers (fake services mode). The owner is the test's
  own browser; the member is in a context of their own, sized like this project's device, and is put
  into the group with the test-only join route. The chat has no realtime service: each browser asks
  for news every 2.5 seconds, so what one person sends shows up for the other within a few seconds
  and every wait for the other person's screen allows for that. A deleted message is noticed by the
  "newest page" look, which happens at most every sixth poll (about 15 seconds). Never resets the
  shared fake store.
*/

const OWNER = "Asha Rao";
const MEMBER = "Ravi Kumar";
const NOT_FOUND_TEXT = "This page could not be found.";
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
const log = (page: Page) => page.getByRole("log", { name: "Messages" });
const messages = (page: Page) => log(page).getByTestId("chat-message");
const message = (page: Page, text: string | RegExp) => messages(page).filter({ hasText: text });
const box = (page: Page) => page.getByLabel("Write a message", { exact: true });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send", exact: true });

async function setUp(page: Page, groupName: string) {
  await signUpAndConfirm(page, { name: OWNER });
  return createGroupThroughForm(page, { name: groupName, mode: "link", fromHome: true });
}

async function addMember(page: Page, browser: Browser, info: TestInfo, group: { code: string }, name = MEMBER): Promise<Page> {
  const person = await newPersonContext(browser, info, page, name);
  extraContexts.push(person.context);
  expect((await joinWith(person.page, group.code)).ok).toBe(true);
  return person.page;
}

async function openChat(page: Page, group: { path: string }) {
  await page.goto(`${group.path}/chat`);
  await expect(log(page)).toBeVisible();
  await expect(box(page)).toBeVisible();
}

/** Types the text and sends it the way this device does: Enter on a computer, the Send button on a phone. */
async function say(page: Page, info: TestInfo, text: string) {
  await box(page).fill(text);
  if (isPhone(info)) await sendButton(page).click();
  else await box(page).press("Enter");
  await expect(box(page)).toHaveValue("");
}

/** What the page shows for a message, with line breaks kept. */
const bodyText = (page: Page, text: string | RegExp) => message(page, text).locator("p").evaluate((p) => p.textContent);

test("an empty chat says so, the Chat tab is lit between Library and Members, and Send waits for text", async ({ page }) => {
  const group = await setUp(page, "Empty Chat");
  await tabs(page).getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(`${group.path}/chat`);
  await expect(page.getByRole("region", { name: "Chat" })).toBeVisible();
  await expect(page.getByText("No messages yet. Say hello to the group.")).toBeVisible();
  await expect(log(page)).toHaveAttribute("aria-live", "polite");

  const links = await tabs(page).getByRole("link").allTextContents();
  expect(links).toEqual(["Library", "Chat", "Members", "Settings"]);
  await expect(tabs(page).getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
  await expect(tabs(page).getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current", /.+/);
  await expect(tabs(page).getByRole("link", { name: "Members" })).not.toHaveAttribute("aria-current", /.+/);

  await expect(sendButton(page)).toBeDisabled();
  await box(page).fill("   \n  ");
  await expect(sendButton(page)).toBeDisabled();
  await box(page).fill("hi");
  await expect(sendButton(page)).toBeEnabled();

  // Library and Members light up on their own pages, Chat does not.
  await tabs(page).getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(group.path);
  await expect(tabs(page).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  await expect(tabs(page).getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current", /.+/);
});

test("the owner sends a message and sees it, the member sees it without reloading and replies, in order", async ({ page, browser }, info) => {
  const group = await setUp(page, "Talking Group");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);

  await say(page, info, "Hello group");
  await expect(message(page, "Hello group")).toHaveAttribute("data-mine", "true");
  await expect(message(page, "Hello group")).toHaveAttribute("data-status", "sent");
  // A time in the viewer's own time zone, "10:42"; never a raw date string.
  await expect(message(page, "Hello group").locator("time")).toHaveText(/^\d{2}:\d{2}$/);

  // The member never reloads: the poll brings it.
  await expect(message(member, "Hello group")).toBeVisible(POLLED);
  await expect(message(member, "Hello group")).toHaveAttribute("data-mine", "false");
  await expect(message(member, "Hello group")).toContainText(OWNER);

  await say(page, info, "Second one");
  await expect(message(member, "Second one")).toBeVisible(POLLED);
  await say(member, info, "Hi Asha");
  await expect(message(member, "Hi Asha")).toHaveAttribute("data-mine", "true");
  await expect(message(page, "Hi Asha")).toBeVisible(POLLED);
  await expect(message(page, "Hi Asha")).toContainText(MEMBER);

  // Oldest at the top, newest at the bottom, on both screens; each message once.
  for (const who of [page, member]) {
    await expect(messages(who)).toHaveCount(3);
    expect(await messages(who).locator("p").allTextContents()).toEqual(["Hello group", "Second one", "Hi Asha"]);
  }
  // The sender's name once for a run: the member sees "Asha Rao" once over her two messages, the
  // owner sees "Ravi Kumar" once and never her own name.
  await expect(log(member).getByText(OWNER, { exact: true })).toHaveCount(1);
  await expect(log(page).getByText(MEMBER, { exact: true })).toHaveCount(1);
  await expect(log(page).getByText(OWNER, { exact: true })).toHaveCount(0);
  await expect(log(member).getByText(MEMBER, { exact: true })).toHaveCount(0);

  // Own messages sit on the right, others' on the left.
  const mine = await message(page, "Hello group").boundingBox();
  const theirs = await message(page, "Hi Asha").boundingBox();
  const bubbleRight = async (text: string) => {
    const box = await message(page, text).locator("p").boundingBox();
    return (box?.x ?? 0) + (box?.width ?? 0);
  };
  expect(mine && theirs).toBeTruthy();
  expect(await bubbleRight("Hello group")).toBeGreaterThan(await bubbleRight("Hi Asha"));

  // A reload shows the same, from the server's own render.
  await member.reload();
  await expect(messages(member)).toHaveCount(3);
});

test("Enter sends on a computer and adds a line on a phone; Shift+Enter always adds a line; line breaks are kept", async ({ page, browser }, info) => {
  const group = await setUp(page, "Keys Group");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);

  await box(page).click();
  await box(page).pressSequentially("line one");
  await box(page).press("Shift+Enter");
  await box(page).pressSequentially("line two");
  await expect(box(page)).toHaveValue("line one\nline two");
  await expect(messages(page)).toHaveCount(0);

  if (isPhone(info)) {
    // On a touch screen plain Enter is a new line too, and the Send button sends.
    await box(page).press("Enter");
    await box(page).pressSequentially("line three");
    await expect(box(page)).toHaveValue("line one\nline two\nline three");
    await expect(messages(page)).toHaveCount(0);
    await sendButton(page).click();
  } else {
    await box(page).press("Enter");
  }
  await expect(box(page)).toHaveValue("");
  await expect(box(page)).toBeFocused();

  const text = isPhone(info) ? "line one\nline two\nline three" : "line one\nline two";
  await expect(message(page, "line one")).toBeVisible();
  expect(await bodyText(page, "line one")).toBe(text);
  await expect(message(page, "line one").locator("p")).toHaveCSS("white-space", "pre-wrap");
  // The other person sees the same line breaks, and the bubble really shows them as lines.
  await expect(message(member, "line one")).toBeVisible(POLLED);
  expect(await bodyText(member, "line one")).toBe(text);
  const lines = text.split("\n").length;
  const height = (await message(member, "line one").locator("p").boundingBox())?.height ?? 0;
  expect(height).toBeGreaterThan(lines * 20);

  // The box grows with its text, up to five lines, then scrolls inside.
  const oneLine = (await box(page).boundingBox())?.height ?? 0;
  await box(page).fill("1\n2\n3");
  const threeLines = (await box(page).boundingBox())?.height ?? 0;
  expect(threeLines).toBeGreaterThan(oneLine + 30);
  await box(page).fill("1\n2\n3\n4\n5\n6\n7\n8\n9");
  const many = (await box(page).boundingBox())?.height ?? 0;
  await box(page).fill("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12");
  expect((await box(page).boundingBox())?.height ?? 0).toBe(many);
  expect(many).toBeLessThan(oneLine + 5 * 24 + 10);
  await box(page).fill("");
  expect((await box(page).boundingBox())?.height ?? 0).toBeLessThanOrEqual(oneLine + 1);
});

test("a message is limited to 2000 characters and a long one wraps without sideways scrolling", async ({ page, browser }, info) => {
  const group = await setUp(page, "Limit Group");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);

  await expect(box(page)).toHaveAttribute("maxlength", "2000");
  await box(page).fill("w".repeat(2001));
  const typed = await box(page).inputValue();
  expect(typed.length).toBe(2000);
  await expect(page.getByText("2000/2000")).toBeVisible();
  if (isPhone(info)) await sendButton(page).click();
  else await box(page).press("Enter");
  await expect(message(page, /w{2000}/)).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  await expect(message(member, /w{2000}/)).toBeVisible(POLLED);
  expect((await bodyText(member, /w{2000}/))?.length).toBe(2000);
  expect(await sidewaysOverflow(member)).toBeLessThanOrEqual(0);
  // The bubble stays inside the list.
  const list = await log(member).boundingBox();
  const bubble = await message(member, /w{2000}/).locator("p").boundingBox();
  expect(bubble && list && bubble.x + bubble.width <= list.x + list.width + 1).toBe(true);
});

test("a send that fails can be retried with the same message, and it appears once for everyone", async ({ page, browser }, info) => {
  const group = await setUp(page, "Retry Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);

  // The first try never reaches the server; the second reaches it but its answer is lost; the third works.
  let attempt = 0;
  const bodies: string[] = [];
  await page.route(`**${group.path}/chat`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    attempt += 1;
    bodies.push(request.postData() ?? "");
    if (attempt === 1) return route.abort("connectionreset");
    if (attempt === 2) {
      await route.fetch();
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  await say(page, info, "Retry me please");
  const failed = message(page, "Retry me please");
  await expect(failed).toHaveAttribute("data-status", "failed");
  await expect(page.getByRole("button", { name: "Not sent. Tap to retry" })).toBeVisible();
  await expect(messages(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Not sent. Tap to retry" }).click();
  await expect(failed).toHaveAttribute("data-status", "failed");
  await page.getByRole("button", { name: "Not sent. Tap to retry" }).click();
  await expect(failed).toHaveAttribute("data-status", "sent");
  expect(attempt).toBe(3);
  // The same client id each time: that is what lets the server answer a repeat with the first message.
  const clientIds = bodies.map((body) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(body)?.[0]);
  expect(clientIds[0]).toBeTruthy();
  expect(new Set(clientIds).size).toBe(1);

  await expect(message(member, "Retry me please")).toBeVisible(POLLED);
  // Wait for more polls (including a look at the newest page): still one.
  await page.waitForTimeout(3000);
  await expect(message(page, "Retry me please")).toHaveCount(1);
  await expect(message(member, "Retry me please")).toHaveCount(1);
  await page.reload();
  await expect(message(page, "Retry me please")).toHaveCount(1);
});

test("a failed message can be discarded", async ({ page }, info) => {
  const group = await setUp(page, "Discard Chat");
  await openChat(page, group);
  await page.route(`**${group.path}/chat`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) return route.abort("connectionreset");
    return route.continue();
  });
  await say(page, info, "Never mind");
  await expect(page.getByRole("button", { name: "Not sent. Tap to retry" })).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(messages(page)).toHaveCount(0);
  await expect(page.getByText("No messages yet. Say hello to the group.")).toBeVisible();
});

test("a member deletes their own message only, the owner deletes any, and each is asked first; others see it go", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Delete Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);
  await say(page, info, "Owner words");
  await say(member, info, "Member words one");
  await say(member, info, "Member words two");
  await expect(message(page, "Member words two")).toBeVisible(POLLED);
  await expect(message(member, "Owner words")).toBeVisible(POLLED);

  // The member may delete their own messages, never the owner's.
  await expect(message(member, "Member words one").getByRole("button", { name: /^Delete message/ })).toBeVisible();
  await expect(message(member, "Member words two").getByRole("button", { name: /^Delete message/ })).toBeVisible();
  await expect(message(member, "Owner words").getByRole("button")).toHaveCount(0);
  // The owner may delete all three.
  await expect(page.getByRole("button", { name: /^Delete message/ })).toHaveCount(3);

  // Ask first: Cancel keeps it, and focus starts on Cancel.
  await message(member, "Member words one").getByRole("button", { name: /^Delete message/ }).click();
  const sheet = member.getByRole("dialog", { name: "Delete this message?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(sheet).toContainText("It disappears for everyone in the group");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await expect(message(member, "Member words one")).toBeVisible();

  // Yes, delete: gone at once for the person who deleted it, and for the owner at the next look at the newest page.
  await message(member, "Member words one").getByRole("button", { name: /^Delete message/ }).click();
  await member.getByRole("dialog", { name: "Delete this message?" }).getByRole("button", { name: "Yes, delete", exact: true }).click();
  await expect(member.getByRole("dialog")).toHaveCount(0);
  await expect(message(member, "Member words one")).toHaveCount(0);
  await expect(messages(member)).toHaveCount(2);
  await expect(message(page, "Member words one")).toHaveCount(0, DELETED);
  await expect(messages(page)).toHaveCount(2);

  // The owner deletes the member's message; the sheet says it is the owner's right.
  await message(page, "Member words two").getByRole("button", { name: /^Delete message/ }).click();
  const ownerSheet = page.getByRole("dialog", { name: "Delete this message?" });
  await expect(ownerSheet).toContainText("As the owner you can delete anyone's message");
  await ownerSheet.getByRole("button", { name: "Yes, delete", exact: true }).click();
  await expect(message(page, "Member words two")).toHaveCount(0);
  await expect(message(member, "Member words two")).toHaveCount(0, DELETED);
  await expect(message(member, "Owner words")).toBeVisible();

  // Gone for good: a reload shows only the owner's message.
  await member.reload();
  await expect(messages(member)).toHaveCount(1);
  await expect(message(member, "Owner words")).toBeVisible();
});

test("a removed member is told they can no longer see the chat, and the messages route answers 404; strangers get nothing", async ({ page, browser }, info) => {
  const group = await setUp(page, "Removal Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);
  await say(page, info, "Secret plans");
  await expect(message(member, "Secret plans")).toBeVisible(POLLED);

  const messagesUrl = `${group.path}/chat/messages`;
  expect((await member.request.get(messagesUrl)).status()).toBe(200);
  const stranger = await newPersonContext(browser, info, page, "Zed Stranger");
  extraContexts.push(stranger.context);
  // A stranger: the page is the not-found page, the route a bare 404; same as for a made-up group.
  const made = "/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e";
  expect((await stranger.page.request.get(messagesUrl)).status()).toBe(404);
  expect((await stranger.page.request.get(`${made}/chat/messages`)).status()).toBe(404);
  await stranger.page.goto(`${group.path}/chat`);
  await expect(stranger.page.getByText(NOT_FOUND_TEXT)).toBeVisible();
  await expect(stranger.page.locator("body")).not.toContainText("Secret plans");
  await expect(stranger.page.locator("body")).not.toContainText("Removal Chat");

  // The owner removes the member while their chat is open: the next poll turns it into the plain message.
  await page.goto(`${group.path}/members`);
  await page.getByRole("button", { name: `Remove ${MEMBER}` }).click();
  await page.getByRole("dialog", { name: `Remove ${MEMBER}?` }).getByRole("button", { name: `Yes, remove ${MEMBER}`, exact: true }).click();
  await expect(page.getByRole("list", { name: "Members" }).getByRole("listitem")).toHaveCount(1);

  await expect(member.getByText("You can no longer see this chat")).toBeVisible(POLLED);
  await expect(member.getByRole("link", { name: "Go to your groups" })).toHaveAttribute("href", "/");
  await expect(box(member)).toHaveCount(0);
  await expect(member.getByText("Secret plans")).toHaveCount(0);
  expect((await member.request.get(messagesUrl)).status()).toBe(404);
  await member.reload();
  await expect(member.getByText(NOT_FOUND_TEXT)).toBeVisible();

  // A signed-out visitor is sent to log in, never given messages.
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  extraContexts.push(visitor);
  const answer = await visitor.request.get(messagesUrl, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(answer.status());
  expect(answer.headers()["location"]).toContain("/login");
});

test("a member who leaves keeps their messages under their name; the owner and others see them", async ({ page, browser }, info) => {
  const group = await setUp(page, "Leaving Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(member, group);
  await say(member, info, "Goodbye all");
  await member.goto(`${group.path}/members`);
  await member.getByRole("button", { name: "Leave group" }).click();
  await member.getByRole("dialog", { name: "Leave Leaving Chat?" }).getByRole("button", { name: "Leave group" }).click();
  await expect(member).toHaveURL("/");

  await openChat(page, group);
  await expect(message(page, "Goodbye all")).toContainText(MEMBER);
  await expect(message(page, "Goodbye all").getByRole("button")).toHaveCount(1);
  expect((await member.request.get(`${group.path}/chat/messages`)).status()).toBe(404);
});

test("names of people who left, earlier messages and a dropped connection show properly (server answers stood in)", async ({ page }, info) => {
  const group = await setUp(page, "Stand-in Chat");
  const base = Date.now() - 3 * 24 * 3600 * 1000;
  const made = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    clientId: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    body: `Older message ${n}`,
    senderName: "Former member",
    mine: false,
    canDelete: false,
    createdAt: new Date(base + n * 1000).toISOString(),
    cursor: `cursor${n}`,
    ...extra,
  });
  let before = 0;
  let offline = false;
  await page.route(`**${group.path}/chat/messages**`, async (route) => {
    const url = new URL(route.request().url());
    if (offline) return route.abort("internetdisconnected");
    if (url.searchParams.has("before")) {
      before += 1;
      const older = Array.from({ length: 12 }, (_, i) => made(i + 1, { senderName: "Earlier person", body: `Older message ${i + 1}\nwith a second line\nand a third` }));
      return route.fulfill({ json: { messages: older, hasMore: true, cursor: null, canDeleteAny: false } });
    }
    if (url.searchParams.has("after")) return route.continue();
    // The newest page: add a message from someone whose account is gone, and say earlier ones exist.
    const real = await route.fetch();
    const newest = await real.json();
    // Enough tall messages that the list overflows, as a chat with 50 messages does.
    const fillers = Array.from({ length: 12 }, (_, i) => made(101 + i, { body: `Filler ${i + 1}
second line
third line`, createdAt: new Date(base + (101 + i) * 1000).toISOString() }));
    newest.messages = [made(100, { body: "From a former member", createdAt: new Date(base + 100_000).toISOString() }), ...fillers, ...newest.messages];
    newest.hasMore = true;
    return route.fulfill({ response: real, json: newest });
  });
  await openChat(page, group);
  await say(page, info, "Current message");
  await expect(message(page, "From a former member")).toContainText(CHAT_MESSAGES.formerMember, POLLED);
  // A message from days ago says the day; today's says only the time.
  await expect(message(page, "From a former member").locator("time")).toHaveText(/^\d{1,2} [A-Z][a-z]{2,3}, \d{2}:\d{2}$/);
  await expect(message(page, "Current message").locator("time")).toHaveText(/^\d{2}:\d{2}$/);

  // Load earlier messages: they go above, the messages in view stay where they are, the button stays while more exist.
  const more = page.getByRole("button", { name: "Load earlier messages" });
  await expect(more).toBeVisible();
  const anchor = message(page, "From a former member");
  // Scroll to the button first (as a person would), so a click does not move the list itself.
  await more.scrollIntoViewIfNeeded();
  const before1 = (await anchor.boundingBox())?.y ?? 0;
  await more.click();
  await expect(messages(page).first()).toContainText("Older message 1");
  expect(before).toBe(1);
  const after1 = (await anchor.boundingBox())?.y ?? 0;
  expect(Math.abs(after1 - before1)).toBeLessThan(3);
  await expect(more).toBeVisible();

  // The connection drops: a quiet note, and it clears when the connection is back.
  offline = true;
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting…" })).toBeVisible({ timeout: 15_000 });
  await expect(box(page)).toBeEnabled();
  offline = false;
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting…" })).toHaveCount(0, { timeout: 25_000 });
});

test("a message with HTML in it is shown as text and nothing runs", async ({ page, browser }, info) => {
  const group = await setUp(page, "Markup Chat");
  const member = await addMember(page, browser, info, group);
  const dialogs: string[] = [];
  for (const who of [page, member]) {
    who.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
  }
  await openChat(page, group);
  await openChat(member, group);
  const nasty = '<b>x</b> <img src=x onerror="alert(1)"> <script>alert(2)</script> &amp; "quotes"';
  await say(page, info, nasty);
  for (const who of [page, member]) {
    const bubble = message(who, "<b>x</b>");
    await expect(bubble).toBeVisible(POLLED);
    expect(await bodyText(who, "<b>x</b>")).toBe(nasty);
    await expect(log(who).locator("b, img, script")).toHaveCount(0);
  }
  await member.reload();
  await expect(message(member, "<b>x</b>")).toBeVisible();
  await expect(log(member).locator("b, img, script")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(dialogs).toEqual([]);
});

test("polling pauses while the tab is hidden and catches up at once when it is visible again", async ({ page, browser }, info) => {
  const group = await setUp(page, "Pause Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await openChat(member, group);

  const polls: number[] = [];
  const url = `${group.path}/chat/messages`;
  member.on("request", (request: Request) => {
    if (new URL(request.url()).pathname === url) polls.push(Date.now());
  });
  const setVisibility = (state: "visible" | "hidden") =>
    member.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  // Polling goes on while visible: about one request every 2.5 s.
  const start = polls.length;
  await expect.poll(() => polls.length - start, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  await setVisibility("hidden");
  await member.waitForTimeout(500);
  const hiddenAt = polls.length;
  await say(page, info, "While you were away");
  await member.waitForTimeout(6000);
  expect(polls.length).toBe(hiddenAt);
  await expect(message(member, "While you were away")).toHaveCount(0);

  // Visible again: one request straight away, and the message is there without waiting a full interval.
  await setVisibility("visible");
  await expect(message(member, "While you were away")).toBeVisible({ timeout: 2000 });
  expect(polls.length).toBeGreaterThan(hiddenAt);
});

test("the newest message stays in view, scrolling up is not interrupted, and a New messages button jumps back down", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Scroll Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  for (let n = 1; n <= 10; n++) await say(page, info, `Message ${n}\nsecond line of ${n}\nthird line of ${n}`);
  await expect(messages(page)).toHaveCount(10);

  // Opening the chat shows the end of it.
  await openChat(member, group);
  const scrollTop = () => log(member).evaluate((el) => el.scrollTop);
  const fromBottom = () => log(member).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect(message(member, "Message 10")).toBeInViewport();
  expect(await fromBottom()).toBeLessThan(5);
  await expect(member.getByRole("button", { name: "New messages" })).toHaveCount(0);

  // A new message while at the end scrolls into view by itself.
  await say(page, info, "Message 11");
  await expect(message(member, "Message 11")).toBeInViewport(POLLED);

  // Scrolled up: nothing moves, a button appears.
  await log(member).evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(scrollTop).toBe(0);
  await say(page, info, "Message 12");
  const jump = member.getByRole("button", { name: "New messages" });
  await expect(jump).toBeVisible(POLLED);
  await expect(message(member, "Message 12")).toHaveCount(1);
  expect(await scrollTop()).toBeLessThan(5);
  await expect(message(member, "Message 12")).not.toBeInViewport();

  // The button takes them to the end and goes away.
  await jump.click();
  await expect(message(member, "Message 12")).toBeInViewport();
  await expect(jump).toHaveCount(0);

  // Sending your own message while scrolled up takes you to it.
  await log(member).evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(scrollTop).toBe(0);
  await say(member, info, "My own reply");
  await expect(message(member, "My own reply")).toBeInViewport();
});

test("the chat fits the screen: composer above the tab bar and the keyboard area, nothing scrolls sideways, and it meets the quality bar", async ({ page, browser }, info) => {
  const group = await setUp(page, "Layout Chat");
  const member = await addMember(page, browser, info, group);
  await openChat(page, group);
  await auditPage(page);
  const longWord = `Long-${"x".repeat(150)}`;
  await say(page, info, longWord);
  await say(page, info, "A short one\nwith two lines");
  await openChat(member, group);
  await expect(message(member, "A short one")).toBeVisible();
  await say(member, info, "And a reply from Ravi");
  await expect(message(page, "And a reply")).toBeVisible(POLLED);

  for (const who of [page, member]) {
    expect(await sidewaysOverflow(who)).toBeLessThanOrEqual(0);
    const geometry = await who.evaluate(() => {
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const textarea = document.querySelector("textarea");
      const send = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Send");
      const nav = document.querySelector('nav[aria-label="Group sections"]');
      const viewport = window.visualViewport;
      return {
        height: viewport?.height ?? window.innerHeight,
        width: viewport?.width ?? window.innerWidth,
        textarea: rect(textarea),
        send: rect(send ?? null),
        nav: rect(nav),
        navFixed: nav ? getComputedStyle(nav).position === "fixed" : false,
        scrollable: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    });
    expect(geometry.textarea && geometry.send).toBeTruthy();
    const { textarea, send, nav } = geometry;
    if (!textarea || !send || !nav) throw new Error("composer or tab bar missing");
    // Inside the visible screen, and the button is a real tap target.
    expect(textarea.left).toBeGreaterThanOrEqual(0);
    expect(send.right).toBeLessThanOrEqual(geometry.width + 0.5);
    expect(textarea.bottom).toBeLessThanOrEqual(geometry.height);
    expect(send.height).toBeGreaterThanOrEqual(44);
    expect(send.bottom).toBeLessThanOrEqual(geometry.height);
    if (geometry.navFixed) {
      // On a phone: above the fixed tab bar, with nothing hidden behind it.
      expect(send.bottom).toBeLessThanOrEqual(nav.top + 1);
      expect(nav.bottom).toBeLessThanOrEqual(geometry.height + 1);
    }
    // The page itself does not scroll: the messages do.
    expect(geometry.scrollable).toBeLessThanOrEqual(1);
  }

  if (isPhone(info)) {
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(360);
  }
  await expect(message(page, longWord)).toBeVisible();
  await auditPage(page);

  // With a delete sheet open (the page behind it is hidden from assistive technology by design).
  await message(page, "A short one").getByRole("button", { name: /^Delete message/ }).click();
  await expect(page.getByRole("dialog", { name: "Delete this message?" })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page, { skipAxeRules: ["aria-hidden-focus"] });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // The dark theme too.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(log(page)).toBeVisible();
  await auditPage(page);
});
