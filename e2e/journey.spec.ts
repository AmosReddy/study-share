import { expect, test, type Page } from "@playwright/test";
import {
  createGroupThroughForm,
  DEFAULT_GROUP_PASSWORD,
  enterCode,
  isolateRateLimits,
  lastEmailedCode,
  signUpAndConfirm,
  submitSignUp,
  uniqueEmail,
} from "./helpers";

/*
  The Phase 1b journey, start to finish, as two real people in two separate browsers (the owner
  in the test's own browser, the friend in a new one sized like this project's device). Nothing
  here uses a test-only shortcut to join: both people work through the real pages. It runs on
  desktop, phone-360 and phone-412, and never resets the shared fake store.
*/

const OWNER = "Asha Rao";
const FRIEND = "Ravi Kumar";
const GROUP = "Maths Circle";
const GROUP_PASSWORD = DEFAULT_GROUP_PASSWORD;

const joinButton = (page: Page) => page.getByRole("button", { name: "Join", exact: true });
const passwordBox = (page: Page) => page.getByLabel("Group password", { exact: true });
const memberList = (page: Page) => page.getByRole("list", { name: "Members" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Group sections" });

test.beforeEach(async ({ page }) => {
  await isolateRateLimits(page);
});

test("owner creates a password group, shares, friend joins from the invite, both see each other on Members, friend leaves, friend rejoins with the code", async ({
  page: owner,
  browser,
}, info) => {
  // 1. The owner signs up and creates a group with a password; the password is shown once.
  await signUpAndConfirm(owner, { name: OWNER });
  const { link, code, invitePath } = await createGroupThroughForm(owner, {
    name: GROUP,
    mode: "password",
    password: GROUP_PASSWORD,
    open: false,
  });
  await expect(owner.getByText(GROUP_PASSWORD, { exact: true })).toBeVisible();

  // 2. The owner shares: the link and code on screen, and a WhatsApp message with the link and no password.
  const whatsApp = (await owner.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")) ?? "";
  expect(whatsApp).toContain(encodeURIComponent(link));
  expect(decodeURIComponent(whatsApp)).not.toContain(GROUP_PASSWORD);
  const groupHref = (await owner.getByRole("link", { name: "Open the group" }).getAttribute("href")) ?? "";
  expect(groupHref).toMatch(/^\/groups\/[0-9a-f-]{36}$/);
  await owner.getByRole("link", { name: "Open the group" }).click();
  await expect(owner).toHaveURL(groupHref);

  // 3. The friend, in a browser of their own and signed out, opens the invite from the link.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const context = await browser.newContext({
    baseURL: new URL(owner.url()).origin,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  try {
    const friend = await context.newPage();
    await isolateRateLimits(friend);
    await friend.goto(invitePath);
    await expect(friend.getByRole("heading", { level: 1, name: GROUP, exact: true })).toBeVisible();
    await friend.getByRole("link", { name: "Sign up with email", exact: true }).click();
    await expect(friend).toHaveURL(`/signup?next=${encodeURIComponent(invitePath)}`);

    // 4. Sign-up by emailed code lands back on the same invite, where the password lets them in.
    const email = uniqueEmail("friend");
    await submitSignUp(friend, { name: FRIEND, email });
    await enterCode(friend, await lastEmailedCode(friend.request, email));
    await expect(friend).toHaveURL(invitePath);
    await passwordBox(friend).fill(GROUP_PASSWORD);
    await joinButton(friend).click();
    await expect(friend).toHaveURL(groupHref);
    await expect(friend.getByTestId("group-header").getByRole("heading", { level: 1, name: GROUP })).toBeVisible();

    // 5. Both see each other on Members.
    await tabs(friend).getByRole("link", { name: "Members" }).click();
    await expect(friend).toHaveURL(`${groupHref}/members`);
    await expect(memberList(friend).getByRole("listitem")).toHaveCount(2);
    await expect(memberList(friend)).toContainText(OWNER);
    await expect(memberList(friend)).toContainText(FRIEND);

    await tabs(owner).getByRole("link", { name: "Members" }).click();
    await expect(owner).toHaveURL(`${groupHref}/members`);
    await expect(memberList(owner).getByRole("listitem")).toHaveCount(2);
    await expect(memberList(owner)).toContainText(OWNER);
    await expect(memberList(owner)).toContainText(FRIEND);
    // The owner cannot leave; only the friend has the button.
    await expect(owner.getByRole("button", { name: "Leave group" })).toHaveCount(0);

    // 6. The friend leaves, after a confirm, and is back on the home page without the group.
    await friend.getByRole("button", { name: "Leave group" }).click();
    await friend.getByRole("dialog", { name: `Leave ${GROUP}?` }).getByRole("button", { name: "Leave group" }).click();
    await expect(friend).toHaveURL("/");
    await expect(friend.getByRole("main").getByRole("link", { name: GROUP })).toHaveCount(0);
    await owner.reload();
    await expect(memberList(owner).getByRole("listitem")).toHaveCount(1);
    await expect(memberList(owner)).not.toContainText(FRIEND);

    // 7. The friend rejoins by typing the code in lower case with a hyphen on Join a group.
    await friend.getByRole("main").getByRole("link", { name: "Join with a code" }).click();
    await expect(friend).toHaveURL("/join");
    await friend.getByRole("textbox", { name: "Group code", exact: true }).fill(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase());
    await friend.getByRole("button", { name: "Find group", exact: true }).click();
    await expect(friend).toHaveURL(`/invite/${code}`);
    await expect(friend.getByRole("heading", { level: 1, name: GROUP, exact: true })).toBeVisible();
    await passwordBox(friend).fill(GROUP_PASSWORD);
    await joinButton(friend).click();
    await expect(friend).toHaveURL(groupHref);

    // 8. Both are on Members again.
    await friend.goto(`${groupHref}/members`);
    await expect(memberList(friend).getByRole("listitem")).toHaveCount(2);
    await owner.reload();
    await expect(memberList(owner).getByRole("listitem")).toHaveCount(2);
    await expect(memberList(owner)).toContainText(FRIEND);
  } finally {
    await context.close();
  }
});

