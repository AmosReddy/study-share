import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import { GROUP_MESSAGES } from "../src/shared/group-messages";
import {
  createGroupThroughForm,
  isolateRateLimits,
  joinWith,
  newPersonContext,
  signUpAndConfirm,
} from "./helpers";

/*
  Phase 1c, member management, as real people in real browsers: the owner removes a member, hands the
  group over and deletes it; the other people see what that does to them. The owner is the test's own
  browser, everyone else is in a context of their own, sized like this project's device. People are put
  into the group with the test-only join route (the same use-case as the invite page); everything the
  tests check is done through the real pages. Never resets the shared fake store.
*/

const OWNER = "Asha Rao";
const MEMBER = "Ravi Kumar";
const NOT_FOUND_TEXT = "This page could not be found.";
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

let extraContexts: BrowserContext[] = [];

test.beforeEach(async ({ page }) => {
  extraContexts = [];
  await isolateRateLimits(page);
});

test.afterEach(async () => {
  for (const context of extraContexts) await context.close();
});

const tabs = (page: Page) => page.getByRole("navigation", { name: "Group sections" });
const memberList = (page: Page) => page.getByRole("list", { name: "Members" });
const handOver = (page: Page) => page.getByRole("region", { name: "Hand over this group", exact: true });
/** The signed-in home, fully shown (its "Create a group" link): a list on it is only judged after this. */
const homeShown = (page: Page) => expect(page.getByRole("main").getByRole("link", { name: "Create a group" })).toBeVisible();
const deleteSection = (page: Page) => page.getByRole("region", { name: "Delete this group", exact: true });

/** An owner with a group, and the people who joined it (each in a browser of their own). */
async function setUp(
  { page, browser }: { page: Page; browser: Parameters<typeof newPersonContext>[0] },
  info: Parameters<typeof newPersonContext>[1],
  groupName: string,
  memberNames: string[] = [MEMBER],
) {
  await signUpAndConfirm(page, { name: OWNER });
  const group = await createGroupThroughForm(page, { name: groupName, mode: "link", fromHome: true });
  const members: Page[] = [];
  for (const name of memberNames) {
    const { page: member, context } = await newPersonContext(browser, info, page, name);
    extraContexts.push(context);
    expect((await joinWith(member, group.code)).ok).toBe(true);
    members.push(member);
  }
  return { group, members };
}

/** The page's text and status for an address, once it has shown the not-found text. */
async function notFoundAt(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
  return { status: response?.status(), text: await page.locator("body").innerText() };
}

test("owner removes a member, who then sees not-found, loses the group from their list and cannot rejoin with the link or the code", async ({
  page,
  browser,
}, info) => {
  const { group, members } = await setUp({ page, browser }, info, "Removal Group");
  const [member] = members as [Page];
  await member.goto(group.path);
  await expect(member.getByRole("heading", { level: 1, name: "Removal Group" })).toBeVisible();

  await tabs(page).getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`${group.path}/members`);
  await expect(memberList(page).getByRole("listitem")).toHaveCount(2);
  // Only the other person has a button: the owner's own row has none.
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);
  await expect(memberList(page).getByRole("listitem").nth(0).getByRole("button")).toHaveCount(0);

  // The first tap only asks; Cancel keeps everyone.
  await page.getByRole("button", { name: `Remove ${MEMBER}` }).click();
  const confirm = page.getByRole("dialog", { name: `Remove ${MEMBER}?` });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`${MEMBER} will lose access to Removal Group and won't be able to join this group again.`);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(memberList(page).getByRole("listitem")).toHaveCount(2);

  await page.getByRole("button", { name: `Remove ${MEMBER}` }).click();
  await page.getByRole("dialog", { name: `Remove ${MEMBER}?` }).getByRole("button", { name: `Remove ${MEMBER}` }).click();
  await expect(memberList(page).getByRole("listitem")).toHaveCount(1);
  await expect(memberList(page)).not.toContainText(MEMBER);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The removed person: the group address is exactly a made-up id's not-found page.
  const real = await notFoundAt(member, group.path);
  const madeUp = await notFoundAt(member, "/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e");
  expect(real).toEqual(madeUp);
  expect(await notFoundAt(member, `${group.path}/members`)).toEqual(madeUp);
  expect(real.text).not.toContain("Removal Group");

  // The group is gone from their list after a reload.
  await member.goto("/");
  await homeShown(member);
  await expect(member.getByRole("main").getByRole("link", { name: "Removal Group" })).toHaveCount(0);
  await member.reload();
  await homeShown(member);
  await expect(member.getByRole("main").getByRole("link", { name: "Removal Group" })).toHaveCount(0);

  // The invite link and the code say they cannot join.
  await member.goto(group.invitePath);
  await expect(member.getByText(GROUP_MESSAGES.cannotJoin, { exact: true })).toBeVisible();
  await expect(member.getByRole("button", { name: "Join", exact: true })).toHaveCount(0);
  await member.goto("/join");
  await member.getByRole("textbox", { name: "Group code", exact: true }).fill(group.code);
  await member.getByRole("button", { name: "Find group", exact: true }).click();
  await expect(member).toHaveURL(`/invite/${group.code}`);
  await expect(member.getByText(GROUP_MESSAGES.cannotJoin, { exact: true })).toBeVisible();
  expect((await joinWith(member, group.code)).ok).toBe(false);
});

test("a plain member sees no Remove buttons and no Settings, and the member list in the page source has no user ids", async ({
  page,
  browser,
}, info) => {
  const { group, members } = await setUp({ page, browser }, info, "Quiet Members", [MEMBER, "Meera Iyer"]);
  const [member] = members as [Page, Page];

  await member.goto(`${group.path}/members`);
  await expect(memberList(member).getByRole("listitem")).toHaveCount(3);
  await expect(member.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Leave group" })).toBeVisible();
  await expect(tabs(member).getByRole("link")).toHaveText(["Library", "Members"]);
  await notFoundAt(member, `${group.path}/settings`);

  // Ids are in the owner's page (so the check below is not vacuous) and not in a plain member's.
  const uuids = (html: string) => new Set(html.match(UUID_G)?.map((id) => id.toLowerCase()) ?? []);
  const path = `${group.path}/members`;
  const ownerHtml = await (await page.request.get(path)).text();
  const baseline = uuids(await (await member.request.get("/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e")).text());
  baseline.add(group.id);
  const ownerExtra = [...uuids(ownerHtml)].filter((id) => !baseline.has(id));
  expect(ownerExtra.length).toBeGreaterThanOrEqual(2);

  await member.goto(path);
  await expect(memberList(member).getByRole("listitem")).toHaveCount(3);
  const shown = await member.content();
  const fetched = await (await member.request.get(path)).text();
  for (const html of [shown, fetched]) {
    expect(html).toContain(MEMBER);
    expect([...uuids(html)].filter((id) => !baseline.has(id))).toEqual([]);
    for (const id of ownerExtra) expect(html.toLowerCase()).not.toContain(id);
  }
});

test("owner hands the group over, becomes a plain member, loses Settings, can leave; the new owner has Settings and no Leave button", async ({
  page,
  browser,
}, info) => {
  const { group, members } = await setUp({ page, browser }, info, "Handover Group", [MEMBER, "Meera Iyer"]);
  const [newOwner, other] = members as [Page, Page];

  await tabs(page).getByRole("link", { name: "Members" }).click();
  await expect(page.getByText(GROUP_MESSAGES.ownerCannotLeave)).toBeVisible();
  await page.getByRole("link", { name: "Hand over this group" }).click();
  await expect(page).toHaveURL(`${group.path}/settings`);

  const section = handOver(page);
  await expect(section).toBeVisible();
  await expect(section.getByRole("radio")).toHaveCount(2);
  await expect(section.getByRole("radio", { name: OWNER })).toHaveCount(0);

  // Nothing picked: it asks for someone, and no sheet opens.
  await section.getByRole("button", { name: /^Hand over/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(section.getByText(GROUP_MESSAGES.transferTargetInvalid)).toBeVisible();

  await section.getByRole("radio", { name: MEMBER }).check();
  await section.getByRole("button", { name: /^Hand over/ }).click();
  const confirm = page.getByRole("dialog", { name: `Make ${MEMBER} the owner?` });
  await expect(confirm).toContainText("You will become a regular member and lose access to Settings.");
  // Cancel keeps everything as it was.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(`${group.path}/settings`);

  await section.getByRole("button", { name: /^Hand over/ }).click();
  await page.getByRole("dialog", { name: `Make ${MEMBER} the owner?` }).getByRole("button", { name: `Make ${MEMBER} the owner` }).click();
  await expect(page).toHaveURL(group.path);

  // The previous owner is a plain member: no Settings tab (the address is a not-found page), no Remove, can leave.
  await expect(tabs(page).getByRole("link")).toHaveText(["Library", "Members"]);
  await notFoundAt(page, `${group.path}/settings`);
  await page.goto(`${group.path}/members`);
  await expect(memberList(page).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Leave group" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  await expect(page.getByText(GROUP_MESSAGES.ownerCannotLeave)).toHaveCount(0);

  // The new owner has Settings, Remove buttons, and no Leave button (the hand-over link instead).
  await newOwner.goto(`${group.path}/members`);
  await expect(tabs(newOwner).getByRole("link")).toHaveText(["Library", "Members", "Settings"]);
  await expect(newOwner.getByRole("button", { name: "Leave group" })).toHaveCount(0);
  await expect(newOwner.getByText(GROUP_MESSAGES.ownerCannotLeave)).toBeVisible();
  await expect(newOwner.getByRole("button", { name: `Remove ${OWNER}` })).toBeVisible();
  await expect(newOwner.getByRole("button", { name: "Remove Meera Iyer" })).toBeVisible();
  await expect(memberList(newOwner).getByRole("listitem").nth(0)).toContainText(MEMBER);
  await expect(memberList(newOwner).getByRole("listitem").nth(0)).toContainText("Owner");
  await newOwner.goto(`${group.path}/settings`);
  await expect(handOver(newOwner)).toBeVisible();
  // The invite is the new owner's to see now, and still works.
  await expect(newOwner.getByTestId("invite-code")).toHaveText(group.code);

  // Someone else who is a plain member still sees no owner controls.
  await other.goto(`${group.path}/members`);
  await expect(memberList(other).getByRole("listitem")).toHaveCount(3);
  await expect(other.getByRole("button", { name: "Leave group" })).toBeVisible();
  await expect(other.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  await expect(other.getByText("Owner", { exact: true })).toHaveCount(1);

  // The previous owner leaves like any member, and is gone from the list.
  await page.goto(`${group.path}/members`);
  await page.getByRole("button", { name: "Leave group" }).click();
  await page.getByRole("dialog", { name: "Leave Handover Group?" }).getByRole("button", { name: "Leave group" }).click();
  await expect(page).toHaveURL("/");
  await newOwner.goto(`${group.path}/members`);
  await expect(memberList(newOwner).getByRole("listitem")).toHaveCount(2);
  await expect(memberList(newOwner)).not.toContainText(OWNER);
});

test("hand-over is disabled when nobody else is in the group", async ({ page }) => {
  await signUpAndConfirm(page, { name: OWNER });
  const group = await createGroupThroughForm(page, { name: "Solo Group", mode: "link", fromHome: true });
  await page.goto(`${group.path}/settings`);

  const section = handOver(page);
  await expect(section).toBeVisible();
  await expect(section.getByText("Nobody else is in this group yet.")).toBeVisible();
  await expect(section.getByRole("radio")).toHaveCount(0);
  const button = section.getByRole("button", { name: /^Hand over/ });
  await expect(button).toBeDisabled();
  await button.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("deleting a group needs the exact name; afterwards members see not-found, the invite says it is no longer valid and the group is gone from every list", async ({
  page,
  browser,
}, info) => {
  const { group, members } = await setUp({ page, browser }, info, "Delete Test Group");
  const [member] = members as [Page];
  await member.goto(group.path);
  await expect(member.getByRole("heading", { level: 1, name: "Delete Test Group" })).toBeVisible();

  await page.goto(`${group.path}/settings`);
  await expect(deleteSection(page)).toBeVisible();
  await expect(deleteSection(page)).toContainText("kept for 30 days");
  await deleteSection(page).getByRole("button", { name: "Delete group…" }).click();
  const sheet = page.getByRole("dialog", { name: "Delete Delete Test Group?" });
  const box = sheet.getByLabel("Type Delete Test Group to confirm", { exact: true });
  const confirmButton = sheet.getByRole("button", { name: "Delete this group", exact: true });
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("autocomplete", "off");
  await expect(box).toHaveAttribute("spellcheck", "false");
  await expect(confirmButton).toBeDisabled();
  // Nothing short of the exact name enables it.
  for (const typed of ["Delete Test", "delete test group", "Delete Test Group "]) {
    await box.fill(typed);
    await expect(confirmButton).toBeDisabled();
  }

  // The server checks too: a name that was changed meanwhile (here from another tab) is refused on the input.
  const other = await page.context().newPage();
  await isolateRateLimits(other);
  await other.goto(`${group.path}/settings`);
  await other.getByLabel("Group name", { exact: true }).fill("Delete Test Group Two");
  await other.getByRole("button", { name: "Save details" }).click();
  await expect(other.getByText("Saved.")).toBeVisible();
  await other.close();

  await box.fill("Delete Test Group");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(sheet.getByText(GROUP_MESSAGES.deleteNameMismatch)).toBeVisible();
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(box).toHaveAccessibleDescription(GROUP_MESSAGES.deleteNameMismatch);
  await expect(page).toHaveURL(`${group.path}/settings`);

  // Nothing was deleted; closing the sheet and opening it again starts over.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await member.reload();
  await expect(member.getByRole("heading", { level: 1, name: "Delete Test Group Two" })).toBeVisible();

  await page.reload();
  await deleteSection(page).getByRole("button", { name: "Delete group…" }).click();
  const second = page.getByRole("dialog", { name: "Delete Delete Test Group Two?" });
  await expect(second.getByLabel("Type Delete Test Group Two to confirm", { exact: true })).toHaveValue("");
  await second.getByLabel("Type Delete Test Group Two to confirm", { exact: true }).fill("Delete Test Group Two");
  await second.getByRole("button", { name: "Delete this group", exact: true }).click();
  await expect(page).toHaveURL("/");
  await homeShown(page);
  await expect(page.getByRole("main").getByRole("link", { name: /Delete Test Group/ })).toHaveCount(0);

  // The member: not-found, a dead invite (link and code), and nothing in their list.
  const real = await notFoundAt(member, group.path);
  expect(real).toEqual(await notFoundAt(member, "/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e"));
  await member.goto(group.invitePath);
  await expect(member.getByText(GROUP_MESSAGES.invalidInvite, { exact: true })).toBeVisible();
  await member.goto(`/invite/${group.code}`);
  await expect(member.getByText(GROUP_MESSAGES.invalidInvite, { exact: true })).toBeVisible();
  await member.goto("/");
  await homeShown(member);
  await expect(member.getByRole("main").getByRole("link", { name: /Delete Test Group/ })).toHaveCount(0);
  await expect(member.getByRole("link", { name: /Delete Test Group/ })).toHaveCount(0);

  // The owner too.
  await notFoundAt(page, `${group.path}/settings`);
  await page.goto("/");
  await homeShown(page);
  await expect(page.getByRole("link", { name: /Delete Test Group/ })).toHaveCount(0);
  expect((await joinWith(member, group.code)).ok).toBe(false);
});

test("a failed remove request shows an inline error and the member stays", async ({ page, browser }, info) => {
  const { group } = await setUp({ page, browser }, info, "Flaky Removal");
  await page.goto(`${group.path}/members`);
  await expect(memberList(page).getByRole("listitem")).toHaveCount(2);

  let broken = true;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (broken && request.method() === "POST" && request.headers()["next-action"]) return route.abort("failed");
    return route.continue();
  });

  await page.getByRole("button", { name: `Remove ${MEMBER}` }).click();
  const sheet = page.getByRole("dialog", { name: `Remove ${MEMBER}?` });
  const confirm = sheet.getByRole("button", { name: `Remove ${MEMBER}` });
  await confirm.click();
  await expect(sheet.getByRole("alert").filter({ hasText: AUTH_MESSAGES.actionFailed })).toBeVisible();
  await expect(confirm).toBeEnabled();
  // The sheet is modal, so the list behind it is hidden from the accessibility tree: look at the markup.
  const rows = page.locator('ul[aria-label="Members"] > li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(MEMBER);

  // Trying again once the network is back works.
  broken = false;
  await confirm.click();
  await expect(memberList(page).getByRole("listitem")).toHaveCount(1);
  await expect(memberList(page)).not.toContainText(MEMBER);
});

test("removing the first of two members leaves no confirm dialog open for the next one", async ({ page, browser }, info) => {
  const { group, members } = await setUp({ page, browser }, info, "Two Members", ["Anil Das", "Bela Nair"]);
  const [, second] = members as [Page, Page];
  await page.goto(`${group.path}/members`);
  await expect(memberList(page).getByRole("listitem")).toHaveCount(3);

  await page.getByRole("button", { name: "Remove Anil Das" }).click();
  await page.getByRole("dialog", { name: "Remove Anil Das?" }).getByRole("button", { name: "Remove Anil Das" }).click();
  await expect(memberList(page).getByRole("listitem")).toHaveCount(2);
  await expect(memberList(page)).not.toContainText("Anil Das");
  await expect(memberList(page)).toContainText("Bela Nair");

  // Nothing is left open, least of all a confirm for the person who moved into the removed row.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Remove Bela Nair?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Bela Nair" })).toBeVisible();

  // Bela is still a member.
  await second.goto(group.path);
  await expect(second.getByRole("heading", { level: 1, name: "Two Members" })).toBeVisible();
  await second.goto(`${group.path}/members`);
  await expect(memberList(second).getByRole("listitem")).toHaveCount(2);
});
