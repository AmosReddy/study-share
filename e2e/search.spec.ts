import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { FILE_MESSAGES } from "../src/shared/file-messages";
import { auditPage } from "./audit";
import { createGroupThroughForm, isolateRateLimits, joinWith, newPersonContext, sidewaysOverflow, signUpAndConfirm } from "./helpers";

/*
  Slice 2, search and filters in the Library, as real people in real browsers (fake services mode,
  same style as files.spec.ts). The owner is the test's own browser; a second uploader is only
  made for the paging test, because one person may start only 15 uploads an hour. Files are tiny
  buffers made in memory. Never resets the shared fake store.
*/

const OWNER = "Asha Rao";
const MEMBER = "Ravi Kumar";

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

type Upload = { name: string; mimeType: string; buffer: Buffer; title: string; type: string; subject: string };

const A: Upload = { name: "unit1.pdf", mimeType: "application/pdf", buffer: PDF, title: "Unit 1 notes", type: "Notes", subject: "Physics" };
const B: Upload = { name: "board.png", mimeType: "image/png", buffer: PNG, title: "Board diagram", type: "Previous year paper", subject: "Maths" };
const C: Upload = { name: "chapter-zebra.txt", mimeType: "text/plain", buffer: TEXT, title: "Algebra sheet", type: "Assignment", subject: "Maths" };
const D: Upload = { name: "hindi.txt", mimeType: "text/plain", buffer: TEXT, title: "भौतिकी सार", type: "Notes", subject: "भौतिकी & Co" };
const E: Upload = { name: "weird.txt", mimeType: "text/plain", buffer: TEXT, title: 'Tips 100% done_ok "quoted"', type: "Other", subject: "Odd +chars" };
const ALL = [A, B, C, D, E];

let extraContexts: BrowserContext[] = [];

test.beforeEach(async ({ page }) => {
  extraContexts = [];
  await isolateRateLimits(page);
});

test.afterEach(async () => {
  for (const context of extraContexts) await context.close();
});

const library = (page: Page) => page.getByRole("region", { name: "Library" });
const fileList = (page: Page) => library(page).getByRole("list", { name: "Files" });
const items = (page: Page) => fileList(page).getByRole("listitem");
const searchBox = (page: Page) => library(page).getByLabel("Search files");
const typeSelect = (page: Page) => library(page).getByLabel("Type", { exact: true });
const subjectSelect = (page: Page) => library(page).getByLabel("Subject", { exact: true });
const searchButton = (page: Page) => library(page).getByRole("button", { name: "Search", exact: true });
const clearLink = (page: Page) => library(page).getByRole("link", { name: "Clear", exact: true });
const summary = (page: Page) => library(page).getByTestId("results-summary");
const noMatch = (page: Page) => library(page).getByText("No files match your search. Try different words or clear the filters.");

/** The address's parameters that are set (a plain form post also sends empty ones, which mean "not set"). */
function params(page: Page): Record<string, string> {
  return Object.fromEntries([...new URL(page.url()).searchParams].filter(([, value]) => value !== ""));
}

async function titlesShown(page: Page): Promise<string[]> {
  return items(page).evaluateAll((nodes) => nodes.map((node) => node.querySelector("a > span > span")?.textContent ?? ""));
}

/** Uploads through the real form and waits for the library. */
async function upload(page: Page, groupPath: string, file: Upload) {
  await page.goto(`${groupPath}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await page.getByLabel("Title", { exact: true }).fill(file.title);
  await page.getByLabel("Type", { exact: true }).selectOption({ label: file.type });
  await page.getByLabel("Subject (optional)").fill(file.subject);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page).toHaveURL(`${groupPath}?notice=uploaded`);
  await expect(library(page).getByText(FILE_MESSAGES.notices.uploaded)).toBeVisible();
}

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

/** Types into the search box and sends it with the Enter key. */
async function search(page: Page, text: string) {
  await searchBox(page).fill(text);
  await searchBox(page).press("Enter");
}

/**
 * Changes a dropdown and waits for the address to follow. A page that has only just loaded may not
 * be interactive yet, so the change is repeated until it takes (choosing the same option again is harmless).
 */
async function choose(page: Page, select: (page: Page) => Locator, label: string, key: string, value: string) {
  await expect(async () => {
    await select(page).selectOption({ label });
    expect(params(page)[key] ?? "").toBe(value);
  }).toPass();
}

test("an empty library has no search or filters; with files, search finds title, subject and file name, ignoring case", async ({ page }) => {
  const group = await setUp(page, "Search Group");
  await expect(library(page).getByRole("heading", { name: "No files yet" })).toBeVisible();
  await expect(searchBox(page)).toHaveCount(0);
  await expect(typeSelect(page)).toHaveCount(0);
  await expect(subjectSelect(page)).toHaveCount(0);

  for (const file of ALL) await upload(page, group.path, file);

  // The page right after an upload still has ?notice=uploaded; a search does not carry it along.
  await expect(searchBox(page)).toBeVisible();
  await expect(searchBox(page)).toHaveAttribute("type", "search");
  await expect(searchBox(page)).toHaveAttribute("maxlength", "100");
  await expect(searchBox(page)).toHaveAttribute("placeholder", "Search by title, subject or file name");
  await expect(searchButton(page)).toBeVisible();
  await expect(clearLink(page)).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);
  await expect(items(page)).toHaveCount(5);
  await expect.poll(() => titlesShown(page)).toEqual([E.title, D.title, C.title, B.title, A.title]);

  // By a word of the title. The box keeps what was typed, the address holds the search, Clear appears.
  await search(page, "unit");
  await expect(summary(page)).toHaveText('1 file matches "unit"');
  expect(params(page)).toEqual({ q: "unit" });
  await expect.poll(() => titlesShown(page)).toEqual([A.title]);
  await expect(searchBox(page)).toHaveValue("unit");
  await expect(clearLink(page)).toHaveAttribute("href", group.path);
  await expect(library(page).getByText(FILE_MESSAGES.notices.uploaded)).toHaveCount(0);

  // Case does not matter.
  await search(page, "UNIT");
  await expect(summary(page)).toHaveText('1 file matches "UNIT"');
  await expect.poll(() => titlesShown(page)).toEqual([A.title]);

  // Reload keeps the results and the typed text; Back goes to the earlier search.
  await page.reload();
  await expect(summary(page)).toHaveText('1 file matches "UNIT"');
  await expect(searchBox(page)).toHaveValue("UNIT");
  await page.goBack();
  await expect(searchBox(page)).toHaveValue("unit");
  expect(params(page)).toEqual({ q: "unit" });
  await page.goBack();
  await expect(items(page)).toHaveCount(5);
  await expect(searchBox(page)).toHaveValue("");

  // By subject (two files), and by a file name that is in no title.
  await search(page, "maths");
  await expect(summary(page)).toHaveText('2 files match "maths"');
  await expect.poll(() => titlesShown(page)).toEqual([C.title, B.title]);
  await search(page, "zebra");
  await expect(summary(page)).toHaveText('1 file matches "zebra"');
  await expect.poll(() => titlesShown(page)).toEqual([C.title]);
  await search(page, "BOARD.PNG");
  await expect(summary(page)).toHaveText('1 file matches "BOARD.PNG"');
  await expect.poll(() => titlesShown(page)).toEqual([B.title]);

  // Clear puts everything back.
  await clearLink(page).click();
  await expect(page).toHaveURL(group.path);
  await expect(items(page)).toHaveCount(5);
  await expect(searchBox(page)).toHaveValue("");
  await expect(clearLink(page)).toHaveCount(0);
});

test("the Type and Subject dropdowns apply at once, combine with search, round-trip odd subjects and survive reload", async ({ page }) => {
  const group = await setUp(page, "Filter Group");
  for (const file of ALL) await upload(page, group.path, file);
  await page.goto(group.path);

  // The choices: all five types, and the subjects the group uses, each once.
  await expect(typeSelect(page).locator("option")).toHaveText([
    "All types",
    "Notes",
    "Previous year paper",
    "Study material",
    "Assignment",
    "Other",
  ]);
  await expect(subjectSelect(page).locator("option")).toHaveText(["All subjects", "Maths", "Odd +chars", "Physics", "भौतिकी & Co"]);

  // Type filter.
  await choose(page, typeSelect, "Notes", "type", "notes");
  await expect(summary(page)).toHaveText("2 files match your filters");
  await expect.poll(() => titlesShown(page)).toEqual([D.title, A.title]);
  await expect(typeSelect(page)).toHaveValue("notes");
  await expect(clearLink(page)).toBeVisible();

  // Subject filter on top of it: Notes and Maths is empty, and says so in friendly words.
  await choose(page, subjectSelect, "Maths", "subject", "Maths");
  expect(params(page)).toEqual({ type: "notes", subject: "Maths" });
  await expect(noMatch(page)).toBeVisible();
  await expect(library(page).getByRole("heading", { name: "No files yet" })).toHaveCount(0);
  await expect(library(page).getByRole("link", { name: "Clear search and filters" })).toHaveAttribute("href", group.path);
  await expect(summary(page)).toHaveCount(0);
  // The controls stay, so the person can change them.
  await expect(typeSelect(page)).toHaveValue("notes");
  await expect(subjectSelect(page)).toHaveValue("Maths");

  // Change the type: Maths with Assignment finds one; reload keeps it.
  await choose(page, typeSelect, "Assignment", "type", "assignment");
  await expect(summary(page)).toHaveText("1 file matches your filters");
  await expect.poll(() => titlesShown(page)).toEqual([C.title]);
  await page.reload();
  await expect.poll(() => titlesShown(page)).toEqual([C.title]);
  await expect(typeSelect(page)).toHaveValue("assignment");
  await expect(subjectSelect(page)).toHaveValue("Maths");

  // Search, type and subject together; the typed text rides along with a dropdown change.
  await choose(page, typeSelect, "All types", "type", "");
  expect(params(page)).toEqual({ subject: "Maths" });
  await expect(summary(page)).toHaveText("2 files match your filters");
  await searchBox(page).fill("board");
  await choose(page, typeSelect, "Previous year paper", "type", "pyq");
  expect(params(page)).toEqual({ q: "board", type: "pyq", subject: "Maths" });
  await expect(summary(page)).toHaveText('1 file matches "board" and your filters');
  await expect.poll(() => titlesShown(page)).toEqual([B.title]);
  await search(page, "algebra");
  await expect(noMatch(page)).toBeVisible();

  // Back through the history follows the boxes.
  await page.goBack();
  await expect(searchBox(page)).toHaveValue("board");
  await expect(typeSelect(page)).toHaveValue("pyq");
  await page.goBack();
  await expect(searchBox(page)).toHaveValue("");
  await expect(typeSelect(page)).toHaveValue("");
  await expect(subjectSelect(page)).toHaveValue("Maths");

  // Clear from a combined state.
  await page.goto(`${group.path}?q=board&type=pyq&subject=Maths`);
  await expect(items(page)).toHaveCount(1);
  await clearLink(page).click();
  await expect(page).toHaveURL(group.path);
  await expect(items(page)).toHaveCount(5);
  await expect(subjectSelect(page)).toHaveValue("");
  await expect(typeSelect(page)).toHaveValue("");

  // A Hindi subject with an ampersand and a subject with a plus sign survive the address.
  await choose(page, subjectSelect, "भौतिकी & Co", "subject", "भौतिकी & Co");
  await expect.poll(() => titlesShown(page)).toEqual([D.title]);
  await page.reload();
  await expect(subjectSelect(page)).toHaveValue("भौतिकी & Co");
  await expect.poll(() => titlesShown(page)).toEqual([D.title]);
  await choose(page, subjectSelect, "Odd +chars", "subject", "Odd +chars");
  await expect.poll(() => titlesShown(page)).toEqual([E.title]);
  await page.reload();
  await expect(subjectSelect(page)).toHaveValue("Odd +chars");
  await expect.poll(() => titlesShown(page)).toEqual([E.title]);

  // The subject is matched without regard to case, and shown with the group's own spelling.
  await page.goto(`${group.path}?subject=MATHS`);
  await expect.poll(() => titlesShown(page)).toEqual([C.title, B.title]);
  await expect(subjectSelect(page)).toHaveValue("Maths");
});

test("odd characters in the search are looked for literally and never break the page", async ({ page }) => {
  const group = await setUp(page, "Odd Group");
  for (const file of ALL) await upload(page, group.path, file);
  await page.goto(group.path);

  const cases: Array<[text: string, expected: string[]]> = [
    ["%", [E.title]],
    ["_", [E.title]],
    ["100%", [E.title]],
    ["%%", []],
    ['"quoted"', [E.title]],
    ["'", []],
    ["+", [E.title]],
    ["&", [D.title]],
    ["भौतिकी", [D.title]],
    ["भौतिकी & co", [D.title]],
    ["\\", []],
    ["a b", []],
  ];
  for (const [text, expected] of cases) {
    await search(page, text);
    await expect(searchBox(page)).toHaveValue(text);
    if (expected.length > 0) {
      await expect(items(page)).toHaveCount(expected.length);
      await expect.poll(() => titlesShown(page)).toEqual(expected);
    } else {
      await expect(noMatch(page)).toBeVisible();
    }
    await expect.poll(() => params(page)).toEqual({ q: text });
    await page.reload();
    await expect(searchBox(page)).toHaveValue(text);
    await expect(items(page)).toHaveCount(expected.length);
  }

  // Typed markup comes back as text, never as markup.
  await search(page, "<b>bold</b><script>window.__x=1</script>");
  await expect(noMatch(page)).toBeVisible();
  await expect(searchBox(page)).toHaveValue("<b>bold</b><script>window.__x=1</script>");
  await expect(page.locator("main b")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();

  // The search box holds at most 100 characters.
  await searchBox(page).fill("z".repeat(150));
  expect(await searchBox(page).inputValue()).toHaveLength(100);
});

test("odd or hostile addresses are answered with the library, never an error", async ({ page }) => {
  const group = await setUp(page, "Hostile Group");
  await upload(page, group.path, A);
  await upload(page, group.path, B);
  const base = group.path;

  // A repeated parameter counts once (the first value).
  await page.goto(`${base}?q=unit&q=board&type=notes&type=pyq&subject=Physics&subject=Maths`);
  await expect.poll(() => titlesShown(page)).toEqual([A.title]);
  await expect(searchBox(page)).toHaveValue("unit");
  await expect(typeSelect(page)).toHaveValue("notes");
  await expect(subjectSelect(page)).toHaveValue("Physics");

  // An unknown type is ignored and is no filter at all (no Clear, no summary).
  await page.goto(`${base}?type=videos`);
  await expect(items(page)).toHaveCount(2);
  await expect(clearLink(page)).toHaveCount(0);
  await expect(typeSelect(page)).toHaveValue("");

  // An unknown subject matches nothing, and the dropdown still shows what is filtering.
  await page.goto(`${base}?subject=Nope`);
  await expect(noMatch(page)).toBeVisible();
  await expect(subjectSelect(page)).toHaveValue("Nope");
  await expect(clearLink(page)).toBeVisible();

  // A very long search is cut, a very long subject matches nothing, and a garbage cursor is no cursor.
  const response = await page.goto(`${base}?q=${"x".repeat(6000)}&subject=${"s".repeat(6000)}`);
  expect(response?.status()).toBe(200);
  await expect(noMatch(page)).toBeVisible();
  expect(await searchBox(page).inputValue()).toHaveLength(100);
  expect((await page.goto(`${base}?cursor=garbage&q=unit`))?.status()).toBe(200);
  await expect(items(page)).toHaveCount(1);
  expect((await page.goto(`${base}?q=%00%01&type=%00&subject=%00`))?.status()).toBe(200);
  await expect(library(page)).toBeVisible();
  expect((await page.goto(`${base}?q[]=a&q[x]=b`))?.status()).toBe(200);
  await expect(library(page)).toBeVisible();

  // The form is a real GET form: sent natively (as it is without JavaScript) it reaches the same results.
  await page.goto(base);
  const form = library(page).getByRole("search");
  await expect(form).toHaveAttribute("method", "get");
  await expect(form).toHaveAttribute("action", base);
  await searchBox(page).fill("board");
  await typeSelect(page).selectOption({ label: "Previous year paper" });
  // Choosing the type already went to the results through the router; now send the form the plain
  // way. Only a real form post adds the empty "subject=" to the address.
  await expect.poll(() => params(page)).toEqual({ q: "board", type: "pyq" });
  await form.evaluate((node) => HTMLFormElement.prototype.submit.call(node));
  await expect(page).toHaveURL(/[?&]subject=(&|$)/);
  await page.waitForLoadState("load");
  expect(params(page)).toEqual({ q: "board", type: "pyq" });
  await expect.poll(() => titlesShown(page)).toEqual([B.title]);
  await expect(searchBox(page)).toHaveValue("board");
});

test("Show more and Back to the newest files keep the search and filters, and a new search starts at the first page", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Paged Search");
  const memberPage = await addMember(page, browser, info, group);
  // 21 files that match "file" as Notes in Maths, and one more that is an Assignment. Two people
  // share the uploads, because one person may start only 15 uploads an hour.
  for (let n = 1; n <= 22; n++) {
    const uploader = n <= 11 ? page : memberPage;
    await upload(uploader, group.path, {
      name: `f${n}.txt`,
      mimeType: "text/plain",
      buffer: TEXT,
      title: `File ${String(n).padStart(2, "0")}`,
      type: n === 22 ? "Assignment" : "Notes",
      subject: "Maths",
    });
  }

  await page.goto(`${group.path}?q=file&type=notes&subject=Maths`);
  await expect(items(page)).toHaveCount(20);
  await expect(summary(page)).toHaveText('Showing 20 files that match "file" and your filters');
  const more = library(page).getByRole("link", { name: "Show more" });
  const href = (await more.getAttribute("href")) ?? "";
  const target = new URL(href, "http://x.test");
  expect(target.searchParams.get("q")).toBe("file");
  expect(target.searchParams.get("type")).toBe("notes");
  expect(target.searchParams.get("subject")).toBe("Maths");
  expect(target.searchParams.get("cursor")).toBeTruthy();
  expect(href).not.toContain("notice");

  await more.click();
  await expect(items(page)).toHaveCount(1);
  await expect.poll(() => titlesShown(page)).toEqual(["File 01"]);
  await expect(summary(page)).toHaveText('Showing 1 more file that matches "file" and your filters');
  expect(params(page)).toMatchObject({ q: "file", type: "notes", subject: "Maths" });
  await expect(searchBox(page)).toHaveValue("file");
  await expect(library(page).getByRole("link", { name: "Show more" })).toHaveCount(0);

  // A new search from a later page starts at the first page again.
  await search(page, "file 0");
  await expect.poll(() => params(page)).toEqual({ q: "file 0", type: "notes", subject: "Maths" });
  await expect(items(page)).toHaveCount(9);
  await expect(library(page).getByRole("link", { name: "Back to the newest files" })).toHaveCount(0);

  // Back to the newest files keeps the filters.
  await page.goto(href);
  await library(page).getByRole("link", { name: "Back to the newest files" }).click();
  await expect.poll(() => params(page)).toEqual({ q: "file", type: "notes", subject: "Maths" });
  await expect(items(page)).toHaveCount(20);

  // Changing a dropdown from a later page drops the cursor too.
  await page.goto(href);
  await expect(items(page)).toHaveCount(1);
  await choose(page, typeSelect, "Assignment", "type", "assignment");
  expect(params(page)).toEqual({ q: "file", type: "assignment", subject: "Maths" });
  await expect(items(page)).toHaveCount(1);
  await expect.poll(() => titlesShown(page)).toEqual(["File 22"]);
});

test("the Library with search and filters fits the screen and meets the phone quality bar", async ({ page }) => {
  const group = await setUp(page, "Layout Search");
  const longSubject = "Computer-Networks-and-Distributed-Systems-and-More-Topics";
  await upload(page, group.path, { ...A, title: `Very-long-title-${"x".repeat(100)}`, subject: longSubject });
  await upload(page, group.path, B);

  const states = [
    group.path,
    `${group.path}?q=very&type=notes&subject=${encodeURIComponent(longSubject)}`,
    `${group.path}?q=${"w".repeat(100)}`,
    `${group.path}?subject=${encodeURIComponent("n".repeat(61))}`,
    `${group.path}?type=assignment`,
  ];
  for (const state of states) {
    await test.step(state.slice(-60), async () => {
      await page.goto(state);
      await expect(searchBox(page)).toBeVisible();
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
      await auditPage(page);
    });
  }
  // The filter controls are at least 44px high.
  for (const control of [searchBox(page), typeSelect(page), subjectSelect(page), searchButton(page)]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});
