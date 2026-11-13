import { expect, test, type Page } from "@playwright/test";
import { auditInBothThemes, auditPage, type PageExpectation } from "./audit";
import {
  codeBox,
  createGroupThroughForm,
  enterCode,
  forgetEmailCooldown,
  isolateRateLimits,
  joinWith,
  lastEmailedCode,
  newPersonContext,
  requestResetCode,
  signUpAndConfirm,
  submitSignUp,
  uniqueEmail,
} from "./helpers";
import { AUTH_MESSAGES } from "../src/shared/auth-messages";
import { GROUP_MESSAGES } from "../src/shared/group-messages";

/*
  The phone quality sweep: every page of Phase 1a and 1b, audited (see ./audit.ts) in the light and
  the dark theme, at 360px wide (the small phone) and at desktop width. phone-412 is skipped
  because 360px is the tighter of the two phones. /welcome needs the one shared fake Google
  account, so it is audited in phone-quality-welcome.spec.ts, which runs in its own project.
  Every audited page names its expected address and landmark (PageExpectation), so a redirect
  to log in or a 404 page can never be audited by mistake.

  The code-based registration screens need state to be reached, which the test sets up through
  the real forms (the browser context keeps the cookies and the session across the two themes):
   - /signup/verify: submit the sign-up form (the pending-sign-up cookie names the address);
     and again with the cookie cleared (the screen asks for the address);
   - /signup/password: the emailed code typed with no cookie, which signs in and then forces a
     new password;
   - /reset-password: Forgot password (the reset-email cookie), and with no cookie;
   - /reset-password/new: Forgot password, then the emailed recovery code.
  The group pages need data, which the test creates through the real forms in one browser, signing
  people out and in as it goes (clearing the cookies is how a signed-out visitor is made):
   - /groups/new, /join: any signed-in person;
   - /groups/<id> (Library), /members, /settings: the owner of a group made with the Create form;
   - /invite/<key>: valid and invalid, signed out and signed in (password and link-only groups);
   - the group pages as a plain member (Members with a Leave button), and with a confirm open.
  The Group created screen, the wrong-password state and the 60-character name are audited in
  groups.spec.ts and invite.spec.ts, so they are not repeated here.
*/

/** For a page with a menu or sheet open; see AuditOptions in ./audit.ts. */
const MODAL_LAYER = { skipAxeRules: ["aria-hidden-focus"] };

/** Audits the sheet that is open, in the light theme and in the dark one. */
async function auditSheetInBothThemes(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /dark/ : /^(?!.*dark)/);
    // Colours are audited at rest: not while the sheet slides in or the buttons fade to the new theme.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    await auditPage(page, MODAL_LAYER);
  }
}

const NAME = "Asha Rao";
const FRIEND = "Ravi Kumar";

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === "phone-412", "The sweep runs at 360px and desktop; 360px is the tighter phone.");
  await isolateRateLimits(page);
});

const h1 = (name: string) => (page: Page) => page.getByRole("heading", { level: 1, name, exact: true });
/** The signed-in app shell's account menu button. */
const accountMenu = (page: Page) => page.getByRole("banner").getByRole("button", { name: NAME, exact: true });
/** The signed-out pitch's "Sign up" link. */
const pitchSignUp = (page: Page) => page.getByRole("main").getByRole("link", { name: "Sign up", exact: true });

const groupHeading = (name: string) => (page: Page) => page.getByRole("heading", { level: 1, name, exact: true });
const inviteProblem = (page: Page) => page.getByText(GROUP_MESSAGES.invalidInvite, { exact: true });
const MADE_UP_KEY = "/invite/made-up-key-that-is-not-real";

/** The Google button and the sentence under it, which sit on the log-in and sign-up pages. */
const googleButton = (page: Page) => page.getByRole("button", { name: "Continue with Google", exact: true });
const googleSentence = (page: Page) => page.locator("p").filter({ hasText: /^By continuing/ });

const SIGNED_OUT_PAGES: Record<string, PageExpectation> = {
  "/": { path: "/", url: "/", landmark: pitchSignUp, absent: accountMenu },
  "/login": { path: "/login", url: "/login", landmark: h1("Log in") },
  "/signup": { path: "/signup", url: "/signup", landmark: h1("Create your account") },
  "/forgot-password": { path: "/forgot-password", url: "/forgot-password", landmark: h1("Reset your password") },
  "/terms": { path: "/terms", url: "/terms", landmark: h1("Terms of use") },
  "/privacy": { path: "/privacy", url: "/privacy", landmark: h1("Privacy Notice") },
};

test.describe("signed out", () => {
  test("/invite/<made-up key> (the invalid message, nothing to join)", async ({ page }) => {
    await auditInBothThemes(page, { path: MADE_UP_KEY, url: MADE_UP_KEY, landmark: inviteProblem });
    await expect(googleButton(page)).toHaveCount(0);
  });

  test("/invite/<key> (a valid invite: the group name and the two ways in)", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    const group = await createGroupThroughForm(page, { name: "Maths Circle", mode: "password" });
    await page.context().clearCookies();
    await auditInBothThemes(page, {
      path: group.invitePath,
      url: group.invitePath,
      landmark: groupHeading("Maths Circle"),
      absent: accountMenu,
    });
    await expect(googleButton(page)).toBeVisible();
  });

  for (const [name, expected] of Object.entries(SIGNED_OUT_PAGES)) {
    test(name, async ({ page }) => {
      await auditInBothThemes(page, expected);
    });
  }

  for (const path of ["/login", "/signup"]) {
    test(`${path} has the Google button with the terms sentence under it`, async ({ page }) => {
      await page.goto(path);
      await expect(googleButton(page)).toBeVisible();
      await expect(googleSentence(page)).toHaveText(AUTH_MESSAGES.googleConsent);
      await expect(googleSentence(page).getByRole("link", { name: "Terms", exact: true })).toBeVisible();
      await expect(googleSentence(page).getByRole("link", { name: "Privacy Notice", exact: true })).toBeVisible();
      await auditInBothThemes(page, SIGNED_OUT_PAGES[path]);
    });
  }

  test("/reset-password (the code step, with no remembered address)", async ({ page }) => {
    await auditInBothThemes(page, {
      path: "/reset-password",
      url: "/reset-password",
      landmark: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(h1("Enter the code")(page)).toBeVisible();
  });

  test("/reset-password (the code step, with the remembered address)", async ({ page }) => {
    const email = uniqueEmail("sweep-reset");
    await requestResetCode(page, email);
    await auditInBothThemes(page, {
      path: "/reset-password",
      url: "/reset-password",
      landmark: codeBox,
      absent: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(page.getByRole("main")).toContainText(email);
  });

  test("/reset-password/new (the new-password step, after the emailed code)", async ({ page }) => {
    const email = uniqueEmail("sweep-new");
    // An unknown address is sent no code (the neutral reply), so the account must exist first.
    await signUpAndConfirm(page, { name: NAME, email });
    await page.context().clearCookies();
    await forgetEmailCooldown(page.request, email);
    await requestResetCode(page, email);
    await enterCode(page, await lastEmailedCode(page.request, email, "recovery"));
    await expect(page).toHaveURL("/reset-password/new");
    await auditInBothThemes(page, {
      path: "/reset-password/new",
      url: "/reset-password/new",
      landmark: h1("Create a new password"),
    });
  });

  test("/signup/verify (the code step, with the pending-sign-up cookie)", async ({ page }) => {
    const email = uniqueEmail("sweep-verify");
    await page.goto("/signup");
    await submitSignUp(page, { name: NAME, email });
    await auditInBothThemes(page, {
      path: "/signup/verify",
      url: "/signup/verify",
      landmark: codeBox,
      absent: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(page.getByRole("main")).toContainText(email);
  });

  test("/signup/verify (the code step, with no cookie: it asks for the address)", async ({ page }) => {
    await page.goto("/signup");
    await submitSignUp(page, { name: NAME, email: uniqueEmail("sweep-nocookie") });
    await page.context().clearCookies();
    await auditInBothThemes(page, {
      path: "/signup/verify",
      url: "/signup/verify",
      landmark: (p) => p.getByLabel("Email", { exact: true }),
    });
    await expect(h1("Enter the code")(page)).toBeVisible();
    await expect(codeBox(page)).toBeVisible();
  });

  test("/signup/password (the forced new-password step after a code with no cookie)", async ({ page }) => {
    const email = uniqueEmail("sweep-password");
    await page.goto("/signup");
    await submitSignUp(page, { name: NAME, email });
    const code = await lastEmailedCode(page.request, email);
    // Without the cookie the code cannot tell the owner from someone else, so it signs in
    // and the person must create a password.
    await page.context().clearCookies();
    await page.reload();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await enterCode(page, code);
    await expect(page).toHaveURL("/signup/password");
    await auditInBothThemes(page, {
      path: "/signup/password",
      url: "/signup/password",
      landmark: h1("Create your password"),
    });
  });
});

test.describe("signed in", () => {
  test("/ (the app shell and the empty home)", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    await expect(accountMenu(page)).toBeVisible();
    await auditInBothThemes(page, {
      path: "/",
      url: "/",
      landmark: accountMenu,
      absent: pitchSignUp,
    });
  });

  test("/account", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    await expect(accountMenu(page)).toBeVisible();
    await auditInBothThemes(page, { path: "/account", url: "/account", landmark: h1("Account") });
  });

  test("/ with the open menu and the group sheet on a phone", async ({ page }, info) => {
    await signUpAndConfirm(page, { name: NAME });
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(accountMenu(page)).toBeVisible();
    await expect(pitchSignUp(page)).toHaveCount(0);
    await accountMenu(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await auditPage(page, MODAL_LAYER);
    await page.keyboard.press("Escape");

    if (info.project.name.startsWith("phone")) {
      await page.getByRole("button", { name: "Open group list" }).click();
      await expect(page.getByRole("navigation", { name: "Groups" })).toBeVisible();
      await auditPage(page, MODAL_LAYER);
    }
  });

  test("/groups/new and /join", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    await auditInBothThemes(page, { path: "/groups/new", url: "/groups/new", landmark: h1("Create a group") });
    await auditInBothThemes(page, { path: "/join", url: "/join", landmark: h1("Join a group") });
  });

  test("an owner's group: Library, Members and Settings", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    const group = await createGroupThroughForm(page, { name: "Maths Circle", mode: "password" });
    // Landmarks that exist only in each tab's own content (the group's title is in the layout, which
    // is there while the tab is still loading).
    const library = (p: Page) => p.getByRole("heading", { level: 3, name: "No files yet", exact: true });
    const memberList = (p: Page) => p.getByRole("list", { name: "Members", exact: true });
    const groupDetails = (p: Page) => p.getByRole("region", { name: "Group details", exact: true });
    await auditInBothThemes(page, { path: group.path, url: group.path, landmark: library });
    await auditInBothThemes(page, { path: `${group.path}/members`, url: `${group.path}/members`, landmark: memberList });
    await auditInBothThemes(page, { path: `${group.path}/settings`, url: `${group.path}/settings`, landmark: groupDetails });
    await expect(groupHeading("Maths Circle")(page)).toBeVisible();

    // The Reset link confirm, open over the Settings page.
    await page.getByRole("button", { name: "Reset link" }).click();
    await expect(page.getByRole("dialog", { name: "Reset the invite link?" })).toBeVisible();
    await auditPage(page, MODAL_LAYER);
    await page.keyboard.press("Escape");

    // The danger zone and the hand-over section below it (nobody to hand over to yet), and the delete
    // confirm: the typed name box, once empty and once with a wrong name (the button stays off).
    await expect(page.getByRole("region", { name: "Hand over this group", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Delete this group", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete group…" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete Maths Circle?" });
    await expect(sheet).toBeVisible();
    await auditSheetInBothThemes(page);
    await sheet.getByLabel("Type Maths Circle to confirm", { exact: true }).fill("Maths");
    await expect(sheet.getByRole("button", { name: "Delete this group", exact: true })).toBeDisabled();
    await auditSheetInBothThemes(page);
  });

  test("an owner's group with a member: Members with Remove, Settings with the hand-over choice, and their confirms", async ({
    page,
    browser,
  }, info) => {
    await signUpAndConfirm(page, { name: NAME });
    const group = await createGroupThroughForm(page, { name: "Maths Circle", mode: "link" });
    const { page: friend, context } = await newPersonContext(browser, info, page, FRIEND);
    try {
      expect((await joinWith(friend, group.code)).ok).toBe(true);
    } finally {
      await context.close();
    }

    const removeButton = (p: Page) => p.getByRole("button", { name: `Remove ${FRIEND}`, exact: true });
    const handOver = (p: Page) => p.getByRole("region", { name: "Hand over this group", exact: true });
    const members = `${group.path}/members`;
    const settings = `${group.path}/settings`;
    await auditInBothThemes(page, { path: members, url: members, landmark: removeButton });
    await expect(page.getByRole("link", { name: "Hand over this group" })).toBeVisible();
    await removeButton(page).click();
    await expect(page.getByRole("dialog", { name: `Remove ${FRIEND}?` })).toBeVisible();
    await auditSheetInBothThemes(page);
    await page.keyboard.press("Escape");

    await auditInBothThemes(page, { path: settings, url: settings, landmark: handOver });
    await expect(handOver(page).getByRole("radio", { name: FRIEND })).toBeVisible();
    // Nothing picked yet: the error under the choice.
    await handOver(page).getByRole("button", { name: /^Hand over/ }).click();
    await expect(handOver(page).getByText(GROUP_MESSAGES.transferTargetInvalid)).toBeVisible();
    await auditPage(page);
    await handOver(page).getByRole("radio", { name: FRIEND }).check();
    await handOver(page).getByRole("button", { name: /^Hand over/ }).click();
    await expect(page.getByRole("dialog", { name: `Make ${FRIEND} the owner?` })).toBeVisible();
    await auditSheetInBothThemes(page);
  });

  test("an owner's link-only group: Settings without a password", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    const group = await createGroupThroughForm(page, { name: "Open Chemistry", mode: "link" });
    const settings = `${group.path}/settings`;
    await auditInBothThemes(page, { path: settings, url: settings, landmark: groupHeading("Open Chemistry") });
    await expect(page.getByRole("radio", { name: /Link only/ })).toBeChecked();
  });

  test("/invite/<key> signed in (password and link-only), then a member's group pages", async ({ page }) => {
    await signUpAndConfirm(page, { name: NAME });
    const passwordGroup = await createGroupThroughForm(page, { name: "Maths Circle", mode: "password" });
    const linkGroup = await createGroupThroughForm(page, { name: "Open Chemistry", mode: "link" });
    await page.context().clearCookies();
    await signUpAndConfirm(page, { name: FRIEND });

    // Signed in and not yet a member: the password box, or just the Join button.
    await auditInBothThemes(page, {
      path: passwordGroup.invitePath,
      url: passwordGroup.invitePath,
      landmark: groupHeading("Maths Circle"),
    });
    await expect(page.getByLabel("Group password", { exact: true })).toBeVisible();
    await auditInBothThemes(page, {
      path: linkGroup.invitePath,
      url: linkGroup.invitePath,
      landmark: groupHeading("Open Chemistry"),
    });
    await expect(page.getByLabel("Group password", { exact: true })).toHaveCount(0);
    await auditInBothThemes(page, { path: MADE_UP_KEY, url: MADE_UP_KEY, landmark: inviteProblem });

    // Join the link-only group, then its pages as a plain member: Members has the Leave button.
    await page.goto(linkGroup.invitePath);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page).toHaveURL(linkGroup.path);
    const members = `${linkGroup.path}/members`;
    const title = groupHeading("Open Chemistry");
    await auditInBothThemes(page, { path: linkGroup.path, url: linkGroup.path, landmark: title });
    await auditInBothThemes(page, { path: members, url: members, landmark: title });
    await expect(page.getByRole("button", { name: "Leave group" })).toBeVisible();

    await page.getByRole("button", { name: "Leave group" }).click();
    await expect(page.getByRole("dialog", { name: "Leave Open Chemistry?" })).toBeVisible();
    await auditPage(page, MODAL_LAYER);
  });
});

/*
  Self-checks: the helper must fail, not pass, when the page is not the intended one. Without
  these, a sweep that quietly audits a 404 page or the login page would look like a pass.
*/
test.describe("the sweep helper refuses a page that is not the intended one", () => {
  const quick = { timeout: 1000 };

  test("an error page (404)", async ({ page }) => {
    await expect(
      auditInBothThemes(page, { path: "/does-not-exist", url: "/does-not-exist", landmark: h1("Log in"), ...quick }),
    ).rejects.toThrow(/error status/);
  });

  test("a redirect to log in instead of the signed-in page", async ({ page }) => {
    // The redirect streams in after the first response, so it shows as the wrong address or a missing landmark.
    await expect(
      auditInBothThemes(page, { path: "/account", url: "/account", landmark: h1("Account"), ...quick }),
    ).rejects.toThrow(/wrong address|own landmark/);
  });

  test("the right address without the page's landmark", async ({ page }) => {
    await expect(
      auditInBothThemes(page, { path: "/login", url: "/login", landmark: h1("Some other heading"), ...quick }),
    ).rejects.toThrow(/own landmark/);
  });

  test("the signed-out pitch where the signed-in home was expected", async ({ page }) => {
    await expect(
      auditInBothThemes(page, { path: "/", url: "/", landmark: pitchSignUp, absent: pitchSignUp, ...quick }),
    ).rejects.toThrow(/look-alike/);
  });
});
