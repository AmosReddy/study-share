import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { FILE_MESSAGES } from "../src/shared/file-messages";
import { auditPage } from "./audit";
import {
  createGroupThroughForm,
  isolateRateLimits,
  joinWith,
  newPersonContext,
  sidewaysOverflow,
  signUpAndConfirm,
} from "./helpers";

/*
  Slice 1, upload and library, as real people in real browsers (fake services mode: the fake file
  storage answers on /api/test/storage, same origin). The owner is the test's own browser;
  everyone else is in a context of their own, sized like this project's device, and is put into the
  group with the test-only join route. Files are tiny buffers made in memory. Never resets the
  shared fake store.
*/

const OWNER = "Asha Rao";
const MEMBER = "Ravi Kumar";
const NOT_FOUND_TEXT = "This page could not be found.";
/** What a storage key looks like: groups/<group id>/<file id>/... (the file page's own address has "files" in between). */
const STORAGE_KEY = /groups\/[0-9a-f-]{36}\/[0-9a-f-]{36}\//;
const FILE_PAGE_URL = /\/files\/[0-9a-f-]{36}$/;

const PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n"),
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const TEXT = Buffer.from("Some plain notes.\n");

type Upload = {
  name: string;
  mimeType: string;
  buffer: Buffer;
  title?: string;
  type?: string;
  subject?: string;
};

let extraContexts: BrowserContext[] = [];

test.beforeEach(async ({ page }) => {
  extraContexts = [];
  await isolateRateLimits(page);
});

test.afterEach(async () => {
  for (const context of extraContexts) await context.close();
});

const tabs = (page: Page) => page.getByRole("navigation", { name: "Group sections" });
const library = (page: Page) => page.getByRole("region", { name: "Library" });
const fileList = (page: Page) => library(page).getByRole("list", { name: "Files" });
const fileLink = (page: Page, title: string | RegExp) => fileList(page).getByRole("link", { name: title });
const uploadButton = (page: Page) => page.getByRole("button", { name: "Upload", exact: true });

/** Opens the upload page and fills the form without sending it. */
async function fillUpload(page: Page, groupPath: string, file: Upload) {
  await page.goto(`${groupPath}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  if (file.title !== undefined) await page.getByLabel("Title", { exact: true }).fill(file.title);
  if (file.type) await page.getByLabel("Type", { exact: true }).selectOption({ label: file.type });
  if (file.subject !== undefined) await page.getByLabel("Subject (optional)").fill(file.subject);
}

/** Uploads through the real form and waits for the library, which says the file is shared. */
async function upload(page: Page, groupPath: string, file: Upload) {
  await fillUpload(page, groupPath, file);
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${groupPath}?notice=uploaded`);
  await expect(library(page).getByText(FILE_MESSAGES.notices.uploaded)).toBeVisible();
  await expect(fileLink(page, file.title ?? file.name.replace(/\.[^.]+$/, "")).first()).toBeVisible();
}

/** The owner (this test's own browser) signs up and makes a group. */
async function setUp(page: Page, groupName: string) {
  await signUpAndConfirm(page, { name: OWNER });
  return createGroupThroughForm(page, { name: groupName, mode: "link", fromHome: true });
}

/** A member in a browser of their own, put into the group with the test-only join route. */
async function addMember(page: Page, browser: Browser, info: TestInfo, group: { code: string }): Promise<Page> {
  const person = await newPersonContext(browser, info, page, MEMBER);
  extraContexts.push(person.context);
  expect((await joinWith(person.page, group.code)).ok).toBe(true);
  return person.page;
}

test("an empty library offers Upload; PDF, PNG and text files appear in the list and open", async ({ page }) => {
  const group = await setUp(page, "Files Group");
  await expect(library(page).getByRole("heading", { name: "No files yet" })).toBeVisible();

  await upload(page, group.path, { name: "unit1.pdf", mimeType: "application/pdf", buffer: PDF, title: "Unit 1 notes", subject: "Physics" });
  await upload(page, group.path, { name: "board.png", mimeType: "image/png", buffer: PNG, title: "Board diagram", type: "Previous year paper" });
  await upload(page, group.path, { name: "plain.txt", mimeType: "text/plain", buffer: TEXT });

  // Newest first, with the details people look for.
  const items = fileList(page).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("plain");
  await expect(items.nth(1)).toContainText("Board diagram");
  await expect(items.nth(1)).toContainText("Previous year paper");
  await expect(items.nth(1)).toContainText(OWNER);
  await expect(items.nth(1)).toContainText(`${PNG.length} B`);
  await expect(items.nth(2)).toContainText("Unit 1 notes");
  await expect(items.nth(2)).toContainText("Notes");
  await expect(items.nth(2)).toContainText("Physics");
  await expect(items.nth(2)).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}/);
  // No storage key or address anywhere in the page.
  const html = await page.content();
  expect(html).not.toMatch(STORAGE_KEY);
  expect(html).not.toContain("/api/test/storage");

  // The PDF: a title, a preview frame that points at our own address, and a download that works.
  await fileLink(page, /Unit 1 notes/).click();
  await expect(page.getByRole("heading", { level: 1, name: "Unit 1 notes" })).toBeVisible();
  await expect(page.getByTestId("file-meta")).toContainText("Shared by Asha Rao");
  const preview = page.getByTestId("file-preview");
  await expect(preview).toHaveJSProperty("tagName", "IFRAME");
  const pdfUrl = new URL(page.url());
  const contentHref = (await preview.getAttribute("src")) ?? "";
  expect(contentHref).toBe(`${pdfUrl.pathname}/content`);
  const newTab = page.getByRole("link", { name: "Open in a new tab" });
  await expect(newTab).toHaveAttribute("href", contentHref);
  await expect(newTab).toHaveAttribute("target", "_blank");
  const download = page.getByRole("link", { name: "Download" });
  const downloadHref = (await download.getAttribute("href")) ?? "";
  expect(downloadHref).toBe(`${pdfUrl.pathname}/download`);
  // The page holds no short-lived storage link and no storage key.
  const pageHtml = await page.content();
  expect(pageHtml).not.toContain("token=");
  expect(pageHtml).not.toContain("/api/test/storage");
  expect(pageHtml).not.toMatch(STORAGE_KEY);

  // The download address answers with a redirect that cannot be cached, then the real file.
  const redirect = await page.request.get(downloadHref, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()["cache-control"]).toBe("no-store");
  expect(redirect.headers()["location"]).toContain("/api/test/storage/");
  const saved = await page.request.get(downloadHref);
  expect(saved.status()).toBe(200);
  expect(saved.headers()["content-disposition"]).toMatch(/^attachment; filename="unit1\.pdf"/);
  expect(Buffer.from(await saved.body()).equals(PDF)).toBe(true);
  // The preview address shows it inline.
  const shown = await page.request.get(contentHref);
  expect(shown.status()).toBe(200);
  expect(shown.headers()["content-type"]).toBe("application/pdf");
  expect(shown.headers()["content-disposition"]).toMatch(/^inline/);
  // Two requests make two different short-lived links.
  const again = await page.request.get(downloadHref, { maxRedirects: 0 });
  expect(again.headers()["location"]).not.toBe(redirect.headers()["location"]);

  // The image: an <img> with the title as its text, that really loaded.
  await page.goto(group.path);
  await fileLink(page, /Board diagram/).click();
  const image = page.getByRole("img", { name: "Board diagram" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);

  // A text file cannot be previewed: Download only, and the preview address is a 404.
  await page.goto(group.path);
  await fileLink(page, /plain/).click();
  await expect(page.getByText("can't be shown in the browser")).toBeVisible();
  await expect(page.getByTestId("file-preview")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
  const textUrl = new URL(page.url());
  expect((await page.request.get(`${textUrl.pathname}/content`)).status()).toBe(404);
  const text = await page.request.get(`${textUrl.pathname}/download`);
  expect(text.status()).toBe(200);
  expect(Buffer.from(await text.body()).equals(TEXT)).toBe(true);
});

test("the title is filled from the file name until the person types their own, and the Library tab stays lit", async ({ page }) => {
  const group = await setUp(page, "Titles Group");
  await page.goto(`${group.path}/upload`);
  const file = page.getByLabel("File", { exact: true });
  const title = page.getByLabel("Title", { exact: true });
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("notes");
  await file.setInputFiles({ name: "Week 3 summary.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(title).toHaveValue("Week 3 summary");
  await file.setInputFiles({ name: "other name.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(title).toHaveValue("other name");
  await title.fill("My own title");
  await file.setInputFiles({ name: "third.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(title).toHaveValue("My own title");

  // Library stays highlighted on the upload page and on a file page; Members does not.
  await expect(tabs(page).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "true");
  await expect(tabs(page).getByRole("link", { name: "Members" })).not.toHaveAttribute("aria-current", /.+/);
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  await expect(tabs(page).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  await fileLink(page, "My own title").click();
  await expect(page.getByRole("heading", { level: 1, name: "My own title" })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "true");
  await tabs(page).getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`${group.path}/members`);
  await expect(tabs(page).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  await expect(tabs(page).getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current", /.+/);
});

test("a wrong kind, an empty or too big file and a fake image are refused in friendly words, and a retry works", async ({ page }) => {
  const group = await setUp(page, "Refusal Group");
  const picker = page.getByLabel("File", { exact: true });
  await page.goto(`${group.path}/upload`);

  // Refused at once, before anything is sent.
  await picker.setInputFiles({ name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ not a program") });
  await expect(page.getByText(FILE_MESSAGES.fileTypeNotAllowed)).toBeVisible();
  await picker.setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
  await expect(page.getByText(FILE_MESSAGES.fileEmpty)).toBeVisible();
  await picker.setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024, 0x41) });
  await expect(page.getByText(FILE_MESSAGES.fileTooBig)).toBeVisible();
  await uploadButton(page).click();
  // Still on the form, still refused, and nothing is sending.
  await expect(page).toHaveURL(`${group.path}/upload`);
  await expect(page.getByText(FILE_MESSAGES.fileTooBig)).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);

  // No file at all.
  await page.goto(`${group.path}/upload`);
  await page.getByLabel("Title", { exact: true }).fill("Nothing chosen");
  await uploadButton(page).click();
  await expect(page.getByText(FILE_MESSAGES.chooseFile)).toBeVisible();

  // A text file named .png: the type is fine, the server then looks at the bytes and says no.
  await page.goto(`${group.path}/upload`);
  await picker.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("this is not a picture at all") });
  await uploadButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: FILE_MESSAGES.doesNotLookLike("image") })).toBeVisible();
  await expect(page).toHaveURL(`${group.path}/upload`);
  await expect(uploadButton(page)).toBeEnabled();

  // The same form takes a real picture next, from a clean start.
  await picker.setInputFiles({ name: "real.png", mimeType: "image/png", buffer: PNG });
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  // The refused files left nothing in the library.
  await expect(fileList(page).getByRole("listitem")).toHaveCount(1);
  await expect(fileLink(page, /real/)).toBeVisible();
});

test("a title that is too long is refused by the server next to the field, and an upload that is cut off can be retried", async ({ page }) => {
  const group = await setUp(page, "Retry Group");
  await fillUpload(page, group.path, { name: "notes.pdf", mimeType: "application/pdf", buffer: PDF, title: "t".repeat(121) });
  await uploadButton(page).click();
  await expect(page.getByText(FILE_MESSAGES.titleTooLong)).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Retry notes");

  // The connection to storage drops: a friendly message, the form is usable again.
  let blocked = true;
  await page.route("**/api/test/storage/**", async (route) => {
    if (blocked) await route.abort("connectionreset");
    else await route.continue();
  });
  await uploadButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: FILE_MESSAGES.uploadInterrupted })).toBeVisible();
  await expect(uploadButton(page)).toBeEnabled();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Retry notes");

  // Back online: the same button starts over and finishes. The cut-off try left nothing visible.
  blocked = false;
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  await expect(fileList(page).getByRole("listitem")).toHaveCount(1);
});

test("while a file is on its way the form shows progress and cannot be sent twice", async ({ page }) => {
  const group = await setUp(page, "Progress Group");
  await fillUpload(page, group.path, { name: "slow.pdf", mimeType: "application/pdf", buffer: PDF, title: "Slow one" });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let puts = 0;
  await page.route("**/api/test/storage/**", async (route) => {
    puts += 1;
    await held;
    await route.continue();
  });
  await uploadButton(page).click();
  const bar = page.getByRole("progressbar", { name: "Upload progress" });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuemin", "0");
  await expect(bar).toHaveAttribute("aria-valuemax", "100");
  await expect(bar).toHaveAttribute("aria-valuenow", /^\d+$/);
  await expect(page.getByTestId("upload-status")).toHaveText(/^(Getting ready…|Uploading \d+%)$/);
  // The button is replaced by its busy state and the fields are locked.
  await expect(page.getByRole("button", { name: "Uploading…" })).toBeDisabled();
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  release();
  await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  expect(puts).toBe(1);
});

test("a member sees every file, edits and deletes only their own, and the owner can delete theirs", async ({ page, browser }, info) => {
  const group = await setUp(page, "Sharing Group");
  const member = await addMember(page, browser, info, group);
  await upload(page, group.path, { name: "owner.pdf", mimeType: "application/pdf", buffer: PDF, title: "Owner's paper" });
  await upload(member, group.path, { name: "ravi.png", mimeType: "image/png", buffer: PNG, title: "Ravi's picture", subject: "Maths" });

  // The member sees both files, with the right uploaders.
  await member.goto(group.path);
  await expect(fileList(member).getByRole("listitem")).toHaveCount(2);
  await expect(fileLink(member, /Owner's paper/)).toContainText(OWNER);
  await expect(fileLink(member, /Ravi's picture/)).toContainText(MEMBER);

  // The owner's file: viewable and downloadable, but no Edit and no Delete.
  await fileLink(member, /Owner's paper/).click();
  await expect(member.getByRole("heading", { level: 1, name: "Owner's paper" })).toBeVisible();
  await expect(member.getByRole("link", { name: "Download" })).toBeVisible();
  await expect(member.getByRole("heading", { name: "Edit details" })).toHaveCount(0);
  await expect(member.getByRole("heading", { name: "Delete file" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: /Delete file/ })).toHaveCount(0);
  const ownerFilePath = new URL(member.url()).pathname;
  expect((await member.request.get(`${ownerFilePath}/download`)).status()).toBe(200);

  // The member's own file: edit it.
  await member.goto(group.path);
  await fileLink(member, /Ravi's picture/).click();
  await expect(member.getByRole("heading", { name: "Edit details" })).toBeVisible();
  await member.getByLabel("Title", { exact: true }).fill("");
  await member.getByRole("button", { name: "Save details" }).click();
  await expect(member.getByText(FILE_MESSAGES.titleRequired)).toBeVisible();
  await member.getByLabel("Title", { exact: true }).fill("Ravi's better picture");
  await member.getByLabel("Type", { exact: true }).selectOption({ label: "Assignment" });
  await member.getByLabel("Subject (optional)").fill("Algebra");
  await member.getByRole("button", { name: "Save details" }).click();
  await expect(member.getByText(FILE_MESSAGES.saved, { exact: true })).toBeVisible();
  await expect(member.getByRole("heading", { level: 1, name: "Ravi's better picture" })).toBeVisible();
  await expect(member.getByTestId("file-meta")).toContainText("Assignment");
  await expect(member.getByTestId("file-meta")).toContainText("Algebra");
  const raviFilePath = new URL(member.url()).pathname;
  await member.goto(group.path);
  await expect(fileLink(member, /Ravi's better picture/)).toContainText("Algebra");

  // The owner cannot edit Ravi's details either, but can delete the file (the sheet asks first).
  await page.goto(raviFilePath);
  await expect(page.getByRole("heading", { level: 1, name: "Ravi's better picture" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit details" })).toHaveCount(0);
  await expect(page.getByText("You can delete this file because you own the group.")).toBeVisible();
  await page.getByRole("button", { name: "Delete file…" }).click();
  const sheet = page.getByRole("dialog", { name: "Delete Ravi's better picture?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Ravi's better picture" })).toBeVisible();
  await page.getByRole("button", { name: "Delete file…" }).click();
  await page
    .getByRole("dialog", { name: "Delete Ravi's better picture?" })
    .getByRole("button", { name: "Yes, delete Ravi's better picture", exact: true })
    .click();
  await expect(page).toHaveURL(`${group.path}?notice=deleted`);
  await expect(library(page).getByText(FILE_MESSAGES.notices.deleted)).toBeVisible();
  await expect(fileList(page).getByRole("listitem")).toHaveCount(1);
  await expect(fileLink(page, /Ravi's better picture/)).toHaveCount(0);

  // Gone for everyone: the page and both routes answer not found.
  await member.goto(raviFilePath);
  await expect(member.getByText(NOT_FOUND_TEXT)).toBeVisible();
  expect((await member.request.get(`${raviFilePath}/download`)).status()).toBe(404);
  expect((await member.request.get(`${raviFilePath}/content`)).status()).toBe(404);

  // The member deletes their own new file, and is taken back to the library with the message.
  await upload(member, group.path, { name: "second.pdf", mimeType: "application/pdf", buffer: PDF, title: "Ravi's second" });
  await fileLink(member, /Ravi's second/).click();
  await member.getByRole("button", { name: "Delete file…" }).click();
  await member
    .getByRole("dialog", { name: "Delete Ravi's second?" })
    .getByRole("button", { name: "Yes, delete Ravi's second", exact: true })
    .click();
  await expect(member).toHaveURL(`${group.path}?notice=deleted`);
  await expect(fileList(member).getByRole("listitem")).toHaveCount(1);
  await expect(fileLink(member, /Owner's paper/)).toBeVisible();
});

test("a stranger, a removed member and a signed-out visitor cannot open a file or its links", async ({ page, browser }, info) => {
  const group = await setUp(page, "Private Group");
  const member = await addMember(page, browser, info, group);
  await upload(page, group.path, { name: "secret.pdf", mimeType: "application/pdf", buffer: PDF, title: "Secret notes" });
  await fileLink(page, /Secret notes/).click();
  await expect(page).toHaveURL(FILE_PAGE_URL);
  const filePath = new URL(page.url()).pathname;
  const madeUpPath = `${group.path}/files/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e`;

  const notFoundPage = async (who: Page, path: string) => {
    const response = await who.goto(path);
    await expect(who.getByText(NOT_FOUND_TEXT)).toBeVisible();
    return { status: response?.status(), text: await who.locator("body").innerText() };
  };
  const expectClosed = async (who: Page) => {
    expect(await notFoundPage(who, filePath)).toEqual(await notFoundPage(who, madeUpPath));
    expect((await who.request.get(`${filePath}/download`)).status()).toBe(404);
    expect((await who.request.get(`${filePath}/content`)).status()).toBe(404);
    expect((await who.request.get(`${madeUpPath}/download`)).status()).toBe(404);
  };

  // A member can open it.
  await member.goto(filePath);
  await expect(member.getByRole("heading", { level: 1, name: "Secret notes" })).toBeVisible();

  // Someone who never joined cannot.
  const stranger = await newPersonContext(browser, info, page, "Zed Stranger");
  extraContexts.push(stranger.context);
  await expectClosed(stranger.page);
  expect((await notFoundPage(stranger.page, filePath)).text).not.toContain("Secret notes");

  // A signed-out visitor is sent to log in, never given the file.
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  extraContexts.push(visitor);
  for (const suffix of ["/download", "/content"]) {
    const answer = await visitor.request.get(`${filePath}${suffix}`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(answer.status());
    expect(answer.headers()["location"]).toContain("/login");
    expect(answer.headers()["location"]).not.toContain("/api/test/storage");
  }

  // The owner removes the member: their open file link and both routes now answer not found.
  await page.goto(`${group.path}/members`);
  await page.getByRole("button", { name: `Remove ${MEMBER}` }).click();
  await page
    .getByRole("dialog", { name: `Remove ${MEMBER}?` })
    .getByRole("button", { name: `Yes, remove ${MEMBER}`, exact: true })
    .click();
  await expect(page.getByRole("list", { name: "Members" }).getByRole("listitem")).toHaveCount(1);
  await expectClosed(member);
});

test("the library, upload and file pages fit the screen, meet the phone quality bar and wrap very long names", async ({ page }) => {
  const group = await setUp(page, "Layout Group");
  const longTitle = `Very-long-title-${"x".repeat(100)}`;
  const longName = `${"long-file-name-".repeat(8)}end.pdf`;
  await upload(page, group.path, { name: longName, mimeType: "application/pdf", buffer: PDF, title: longTitle, subject: "Computer-Networks-and-Distributed-Systems" });
  await upload(page, group.path, { name: "board.png", mimeType: "image/png", buffer: PNG, title: "Board diagram" });

  await page.goto(group.path);
  await expect(fileList(page)).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  await page.goto(`${group.path}/upload`);
  await expect(page.getByLabel("File", { exact: true })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  // With errors shown, and with a file chosen.
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: `${"n".repeat(150)}.exe`, mimeType: "application/x-msdownload", buffer: PNG });
  await expect(page.getByText(FILE_MESSAGES.fileTypeNotAllowed)).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  await page.goto(group.path);
  await fileLink(page, /Very-long-title/).click();
  await expect(page.getByTestId("file-preview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit details" })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  await page.goto(group.path);
  await fileLink(page, /Board diagram/).click();
  await expect(page.getByRole("img", { name: "Board diagram" })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  // The delete sheet over the file page (Radix hides the page behind it while it is open).
  await page.getByRole("button", { name: "Delete file…" }).click();
  const sheet = page.getByRole("dialog", { name: "Delete Board diagram?" });
  await expect(sheet).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page, { skipAxeRules: ["aria-hidden-focus"] });
});

test("a library of more than 20 files shows Show more, the next page and the way back", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Long Library");
  for (let n = 1; n <= 21; n++) {
    await fillUpload(page, group.path, { name: `f${n}.txt`, mimeType: "text/plain", buffer: TEXT, title: `File ${String(n).padStart(2, "0")}` });
    await uploadButton(page).click();
    await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  }
  await page.goto(group.path);
  await expect(fileList(page).getByRole("listitem")).toHaveCount(20);
  await expect(fileLink(page, /File 21/)).toBeVisible();
  await expect(fileLink(page, /File 01/)).toHaveCount(0);
  await expect(library(page).getByRole("link", { name: "Back to the newest files" })).toHaveCount(0);

  await library(page).getByRole("link", { name: "Show more" }).click();
  await expect(page).toHaveURL(/\?cursor=/);
  await expect(fileList(page).getByRole("listitem")).toHaveCount(1);
  await expect(fileLink(page, /File 01/)).toBeVisible();
  await expect(library(page).getByRole("link", { name: "Show more" })).toHaveCount(0);

  await library(page).getByRole("link", { name: "Back to the newest files" }).click();
  await expect(page).toHaveURL(group.path);
  await expect(fileList(page).getByRole("listitem")).toHaveCount(20);
});
