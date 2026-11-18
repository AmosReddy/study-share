import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { FILE_MESSAGES } from "../src/shared/file-messages";
import { FORM_MESSAGES } from "../src/shared/form-config";
import { auditPage } from "./audit";
import {
  createGroupThroughForm,
  isolateRateLimits,
  joinWith,
  newPersonContext,
  setFormConfig,
  sidewaysOverflow,
  signUpAndConfirm,
} from "./helpers";

/*
  The upload form that follows the group (custom upload form, slice 1), as real people in real
  browsers (fake services mode). The default form (types Notes, Previous year paper, Study material,
  Assignment and Other, and an optional Subject) is what every group has; a custom form is given to
  a group through the test-only /api/test/set-form-config route, as its owner will be able to do
  later. Files are tiny buffers made in memory. Never resets the shared fake store.
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

/** A class group's own form: two types, Semester as a required dropdown, Subject as optional text. */
const CLASS_FORM = {
  version: 1,
  types: [
    { id: "t_lecture", label: "Lecture notes" },
    { id: "t_lab", label: "Lab record" },
  ],
  fields: [
    {
      id: "f_sem",
      label: "Semester",
      kind: "dropdown",
      required: true,
      options: [
        { id: "o_1", label: "Semester 1" },
        { id: "o_2", label: "Semester 2" },
        { id: "o_3", label: "Semester 3" },
      ],
    },
    { id: "f_subject", label: "Subject", kind: "text", required: false },
  ],
};

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
const fileLink = (page: Page, title: string | RegExp) => fileList(page).getByRole("link", { name: title });
const uploadButton = (page: Page) => page.getByRole("button", { name: "Upload", exact: true });
const typeField = (page: Page) => page.getByLabel("Type", { exact: true });
const otherField = (page: Page) => page.getByLabel("What kind of file is it?", { exact: true });
const filterType = (page: Page) => library(page).getByLabel("Type", { exact: true });
const clearLink = (page: Page) => library(page).getByRole("link", { name: "Clear", exact: true });
const summary = (page: Page) => library(page).getByTestId("results-summary");
const noMatch = (page: Page) => library(page).getByText("No files match your search. Try different words or clear the filters.");
/** Waits until the select has exactly these options, in this order. */
const expectOptions = (select: Locator, expected: string[]) => expect(select.locator("option")).toHaveText(expected);

async function titlesShown(page: Page): Promise<string[]> {
  return items(page).evaluateAll((nodes) => nodes.map((node) => node.querySelector("a > span > span")?.textContent ?? ""));
}

/** The address's parameters that are set (a plain form post also sends empty ones, which mean "not set"). */
function params(page: Page): Record<string, string> {
  return Object.fromEntries([...new URL(page.url()).searchParams].filter(([, value]) => value !== ""));
}

/** Changes a filter dropdown and waits for the address to follow (repeated until the page is interactive). */
async function choose(page: Page, select: Locator, label: string, key: string, value: string) {
  await expect(async () => {
    await select.selectOption({ label });
    expect(params(page)[key] ?? "").toBe(value);
  }).toPass();
}

type Answers = {
  title?: string;
  /** The option label of the Type select. */
  type?: string;
  /** What kind of file it is, for Other. */
  other?: string;
  /** Any other field: its label as the form shows it, to what to type or the option label to choose. */
  fields?: Record<string, string>;
};

/** Fills a field by its label: a select is chosen by its option text, anything else is typed into. */
async function setField(field: Locator, value: string) {
  if ((await field.evaluate((node) => node.tagName)) === "SELECT") await field.selectOption({ label: value });
  else await field.fill(value);
}

/** Opens the upload page and fills the form without sending it. */
async function fillUpload(page: Page, groupPath: string, answers: Answers = {}, file = { name: "notes.pdf", mimeType: "application/pdf", buffer: PDF }) {
  await page.goto(`${groupPath}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await page.getByLabel("File", { exact: true }).setInputFiles(file);
  if (answers.title !== undefined) await page.getByLabel("Title", { exact: true }).fill(answers.title);
  if (answers.type) await typeField(page).selectOption({ label: answers.type });
  if (answers.other !== undefined) await otherField(page).fill(answers.other);
  for (const [label, value] of Object.entries(answers.fields ?? {})) await setField(page.getByLabel(label, { exact: true }), value);
}

/** Uploads through the real form and waits for the library. */
async function upload(page: Page, groupPath: string, answers: Answers & { title: string }) {
  await fillUpload(page, groupPath, answers);
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${groupPath}?notice=uploaded`);
  await expect(fileLink(page, answers.title).first()).toBeVisible();
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

test("the default form: every type uploads, Other needs its own words, Subject stays optional", async ({ page }) => {
  const group = await setUp(page, "Default Form");
  await page.goto(`${group.path}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();

  // The same form as before: Title, Type, an optional Subject. Other has no text box until it is chosen.
  await expectOptions(typeField(page), ["Notes", "Previous year paper", "Study material", "Assignment", "Other"]);
  await expect(page.getByLabel("Subject (optional)", { exact: true })).toBeVisible();
  await expect(otherField(page)).toHaveCount(0);

  // Choosing Other asks what kind of file it is, right below the Type select and above the details.
  await typeField(page).selectOption({ label: "Other" });
  await expect(otherField(page)).toBeVisible();
  const [typeBox, otherBox, subjectBox] = await Promise.all([
    typeField(page).boundingBox(),
    otherField(page).boundingBox(),
    page.getByLabel("Subject (optional)", { exact: true }).boundingBox(),
  ]);
  expect(otherBox!.y).toBeGreaterThan(typeBox!.y);
  expect(otherBox!.y).toBeLessThan(subjectBox!.y);
  expect(otherBox!.y - (typeBox!.y + typeBox!.height)).toBeLessThan(60);
  // Choosing another type takes the box away again.
  await typeField(page).selectOption({ label: "Notes" });
  await expect(otherField(page)).toHaveCount(0);
  await typeField(page).selectOption({ label: "Other" });

  // Without its words Other is refused at once, next to the box, and nothing is sent.
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "manual.pdf", mimeType: "application/pdf", buffer: PDF });
  await uploadButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.otherRequired)).toBeVisible();
  await expect(otherField(page)).toBeFocused();
  await expect(otherField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(`${group.path}/upload`);
  // Too many characters is refused the same way (40 at most).
  await otherField(page).fill("x".repeat(41));
  await uploadButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.tooLong(40))).toBeVisible();
  await otherField(page).fill("Lab manual");
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  // The list says what kind of file it is, in the person's words.
  await expect(fileLink(page, /manual/)).toContainText("Other: Lab manual");
  await fileLink(page, /manual/).click();
  await expect(page.getByTestId("file-meta")).toContainText("Other: Lab manual");

  // Every default type uploads, and Subject is optional (these four have none).
  for (const type of ["Notes", "Previous year paper", "Study material", "Assignment"]) {
    await upload(page, group.path, { title: `A ${type}`, type });
    await expect(fileLink(page, `A ${type}`)).toContainText(type);
    await expect(fileLink(page, `A ${type}`)).not.toContainText("Subject");
  }

  // Edit the Other file: its words are there, they are needed, and another type drops them.
  await page.goto(group.path);
  await fileLink(page, /manual/).click();
  const edit = page.getByRole("region", { name: "Edit details" });
  await expect(edit.getByLabel("Type", { exact: true })).toHaveValue("other");
  await expect(edit.getByLabel("What kind of file is it?", { exact: true })).toHaveValue("Lab manual");
  await edit.getByLabel("What kind of file is it?", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(edit.getByText(FORM_MESSAGES.otherRequired)).toBeVisible();
  await edit.getByLabel("What kind of file is it?", { exact: true }).fill("Lab handbook");
  await edit.getByLabel("Subject (optional)").fill("Chemistry");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(FILE_MESSAGES.saved, { exact: true })).toBeVisible();
  await expect(page.getByTestId("file-meta")).toContainText("Other: Lab handbook");
  await expect(page.getByTestId("file-meta")).toContainText("Subject: Chemistry");
  await edit.getByLabel("Type", { exact: true }).selectOption({ label: "Study material" });
  await expect(edit.getByLabel("What kind of file is it?", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("file-meta")).toContainText("Study material");
  await expect(page.getByTestId("file-meta")).not.toContainText("Other");
});

test("a group's own form: its types and details, required ones enforced, filters and search follow it", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Class Form");
  await setFormConfig(page, group.id, CLASS_FORM);

  // The form is the group's own: Title, Type (its two types, then Other), Semester (required), Subject (optional).
  await page.goto(`${group.path}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await expectOptions(typeField(page), ["Lecture notes", "Lab record", "Other"]);
  const semester = page.getByLabel("Semester (required)", { exact: true });
  await expectOptions(semester, ["Choose one", "Semester 1", "Semester 2", "Semester 3"]);
  await expect(semester).toHaveValue("");
  await expect(page.getByLabel("Subject (optional)", { exact: true })).toBeVisible();

  // The required Semester is enforced: refused at once, with the cursor on it.
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "r1.pdf", mimeType: "application/pdf", buffer: PDF });
  await uploadButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.chooseOne)).toBeVisible();
  await expect(semester).toBeFocused();
  await expect(page).toHaveURL(`${group.path}/upload`);

  await upload(page, group.path, {
    title: "Lab report 1",
    type: "Lab record",
    fields: { "Semester (required)": "Semester 2", "Subject (optional)": "Optics" },
  });
  await upload(page, group.path, { title: "Lecture 1", type: "Lecture notes", fields: { "Semester (required)": "Semester 1" } });

  // The rows show the type and the details as labels, never an id.
  await expect(fileLink(page, /Lab report 1/)).toContainText("Lab record");
  await expect(fileLink(page, /Lab report 1/)).toContainText("Semester: Semester 2");
  await expect(fileLink(page, /Lab report 1/)).toContainText("Subject: Optics");
  await expect(fileLink(page, /Lecture 1/)).toContainText("Semester: Semester 1");
  await expect(fileLink(page, /Lecture 1/)).not.toContainText("Subject");
  const html = await page.content();
  for (const id of ["t_lab", "t_lecture", "f_sem", "o_2"]) expect(html).not.toContain(`>${id}<`);
  await fileLink(page, /Lab report 1/).click();
  await expect(page.getByTestId("file-meta")).toContainText("Lab record");
  await expect(page.getByTestId("file-meta")).toContainText("Semester: Semester 2");
  await expect(page.getByTestId("file-meta")).toContainText("Subject: Optics");

  // The filter bar: Type, then one filter per detail with its own neutral entry.
  await page.goto(group.path);
  const semesterFilter = library(page).getByLabel("Semester", { exact: true });
  const subjectFilter = library(page).getByLabel("Subject", { exact: true });
  await expectOptions(filterType(page), ["All types", "Lecture notes", "Lab record", "Other"]);
  await expectOptions(semesterFilter, ["Any semester", "Semester 1", "Semester 2", "Semester 3"]);
  await expectOptions(subjectFilter, ["Any subject", "Optics"]);
  await choose(page, semesterFilter, "Semester 2", "d_f_sem", "o_2");
  expect(params(page)).toEqual({ d_f_sem: "o_2" });
  await expect(summary(page)).toHaveText("1 file matches your filters");
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  await choose(page, filterType(page), "Lecture notes", "type", "t_lecture");
  await expect(noMatch(page)).toBeVisible();
  await clearLink(page).click();
  await expect(items(page)).toHaveCount(2);
  await choose(page, filterType(page), "Lab record", "type", "t_lab");
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  await page.reload();
  await expect(filterType(page)).toHaveValue("t_lab");
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);

  // Search finds a file by the label of its choice or its type, and still does after a rename.
  await page.goto(`${group.path}?q=semester%202`);
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  await page.goto(`${group.path}?q=lab%20record`);
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  await page.goto(`${group.path}?q=optics`);
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  const renamed = structuredClone(CLASS_FORM);
  renamed.fields[0]!.options![1]!.label = "Second term";
  await setFormConfig(page, group.id, renamed);
  await page.goto(`${group.path}?q=second%20term`);
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  await page.goto(`${group.path}?q=semester%202`);
  await expect(noMatch(page)).toBeVisible();
  await page.goto(group.path);
  await expect(fileLink(page, /Lab report 1/)).toContainText("Semester: Second term");
});

test("a form that changed while someone filled it in shows the server's answer next to the right field", async ({ page }) => {
  const group = await setUp(page, "Changing Form");
  await setFormConfig(page, group.id, CLASS_FORM);
  await fillUpload(page, group.path, {
    title: "Changed under me",
    type: "Lab record",
    fields: { "Semester (required)": "Semester 3" },
  });

  // The owner removes Lab record and adds a required Campus detail while this page is open.
  await setFormConfig(page, group.id, {
    ...CLASS_FORM,
    types: [CLASS_FORM.types[0], { ...CLASS_FORM.types[1], archived: true }],
    fields: [...CLASS_FORM.fields, { id: "f_campus", label: "Campus", kind: "text", required: true }],
  });
  await uploadButton(page).click();
  // The removed type is explained under Type, and the missing new detail (not on this page) is said in words.
  await expect(typeField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(FORM_MESSAGES.typeRemoved)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: FILE_MESSAGES.formChanged })).toBeVisible();
  await expect(page).toHaveURL(`${group.path}/upload`);
  await expect(uploadButton(page)).toBeEnabled();

  // A fresh page has the new form, and it takes the upload.
  await page.reload();
  await expectOptions(typeField(page), ["Lecture notes", "Other"]);
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "again.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Title", { exact: true }).fill("Changed under me");
  await page.getByLabel("Semester (required)", { exact: true }).selectOption({ label: "Semester 3" });
  await page.getByLabel("Campus (required)", { exact: true }).fill("North");
  await uploadButton(page).click();
  await expect(page).toHaveURL(`${group.path}?notice=uploaded`);
  await expect(fileLink(page, /Changed under me/)).toContainText("Campus: North");
});

test("a removed type, choice or detail stays on old files, marked, and in the filters only while a file uses it", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Removal Form");
  await setFormConfig(page, group.id, CLASS_FORM);
  await upload(page, group.path, {
    title: "Old lab report",
    type: "Lab record",
    fields: { "Semester (required)": "Semester 2", "Subject (optional)": "Optics" },
  });
  await upload(page, group.path, { title: "Lecture 1", type: "Lecture notes", fields: { "Semester (required)": "Semester 1" } });

  // The owner removes the Lab record type, the Semester 2 choice and the Subject detail, and adds Exam paper and Year.
  await setFormConfig(page, group.id, {
    version: 2,
    types: [CLASS_FORM.types[0], { id: "t_exam", label: "Exam paper" }, { ...CLASS_FORM.types[1], archived: true }],
    fields: [
      {
        ...CLASS_FORM.fields[0],
        options: [
          { id: "o_1", label: "Semester 1" },
          { id: "o_2", label: "Semester 2", archived: true },
          { id: "o_3", label: "Semester 3" },
        ],
      },
      { ...CLASS_FORM.fields[1], archived: true },
      { id: "f_year", label: "Year", kind: "text", required: false },
    ],
  });

  // The old file keeps all three, marked; the file page says the same.
  await page.goto(group.path);
  const old = fileLink(page, /Old lab report/);
  await expect(old).toContainText("Lab record (removed)");
  await expect(old).toContainText("Semester: Semester 2 (removed)");
  await expect(old).toContainText("Subject (removed): Optics");
  await expect(fileLink(page, /Lecture 1/)).not.toContainText("removed");

  // The filters keep them while a file uses them, so the old file stays findable.
  const semesterFilter = library(page).getByLabel("Semester", { exact: true });
  await expectOptions(filterType(page), ["All types", "Lecture notes", "Exam paper", "Lab record (removed)", "Other"]);
  await expectOptions(semesterFilter, ["Any semester", "Semester 1", "Semester 2 (removed)", "Semester 3"]);
  await expectOptions(library(page).getByLabel("Subject (removed)", { exact: true }), ["Any subject", "Optics"]);
  await expectOptions(library(page).getByLabel("Year", { exact: true }), ["Any year"]);
  await choose(page, filterType(page), "Lab record (removed)", "type", "t_lab");
  await expect.poll(() => titlesShown(page)).toEqual(["Old lab report"]);
  await choose(page, semesterFilter, "Semester 2 (removed)", "d_f_sem", "o_2");
  await expect.poll(() => titlesShown(page)).toEqual(["Old lab report"]);

  // New uploads are not offered the removed ones.
  await page.goto(`${group.path}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await expectOptions(typeField(page), ["Lecture notes", "Exam paper", "Other"]);
  await expectOptions(page.getByLabel("Semester (required)", { exact: true }), ["Choose one", "Semester 1", "Semester 3"]);
  await expect(page.getByLabel(/^Subject/)).toHaveCount(0);
  await expect(page.getByLabel("Year (optional)", { exact: true })).toBeVisible();

  // Editing the old file shows what it holds, marked, and saves a new title without touching them.
  await page.goto(group.path);
  await fileLink(page, /Old lab report/).click();
  const edit = page.getByRole("region", { name: "Edit details" });
  await expect(edit.getByLabel("Type", { exact: true })).toHaveValue("t_lab");
  await expect(edit.getByLabel("Type", { exact: true }).locator("option:checked")).toHaveText("Lab record (removed)");
  await expect(edit.getByLabel("Semester (required)", { exact: true }).locator("option:checked")).toHaveText("Semester 2 (removed)");
  await expect(edit.getByLabel(/^Subject/)).toHaveCount(0);
  await edit.getByLabel("Title", { exact: true }).fill("Old lab report (final)");
  await edit.getByLabel("Year (optional)", { exact: true }).fill("2024");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(FILE_MESSAGES.saved, { exact: true })).toBeVisible();
  const meta = page.getByTestId("file-meta");
  await expect(meta).toContainText("Lab record (removed)");
  await expect(meta).toContainText("Semester: Semester 2 (removed)");
  await expect(meta).toContainText("Subject (removed): Optics");
  await expect(meta).toContainText("Year: 2024");

  // Once no file uses them, they leave the filters (the old file is deleted).
  await page.getByRole("button", { name: "Delete file…" }).click();
  await page
    .getByRole("dialog", { name: "Delete Old lab report (final)?" })
    .getByRole("button", { name: "Yes, delete Old lab report (final)", exact: true })
    .click();
  await expect(page).toHaveURL(`${group.path}?notice=deleted`);
  await expectOptions(filterType(page), ["All types", "Lecture notes", "Exam paper", "Other"]);
  await expectOptions(library(page).getByLabel("Semester", { exact: true }), ["Any semester", "Semester 1", "Semester 3"]);
  await expect(library(page).getByLabel("Subject (removed)", { exact: true })).toHaveCount(0);
});

test("odd and hostile addresses on a group's own form never break the library", async ({ page }) => {
  const group = await setUp(page, "Hostile Form");
  await setFormConfig(page, group.id, CLASS_FORM);
  await upload(page, group.path, {
    title: "Lab report 1",
    type: "Lab record",
    fields: { "Semester (required)": "Semester 2", "Subject (optional)": "Optics" },
  });
  await upload(page, group.path, { title: "Lecture 1", type: "Lecture notes", fields: { "Semester (required)": "Semester 1" } });
  const base = group.path;
  const semesterFilter = library(page).getByLabel("Semester", { exact: true });

  // A detail the form does not have is no filter at all, whatever its value.
  await page.goto(`${base}?d_nope=x&d_constructor=1&d___proto__=1&d_=1`);
  await expect(items(page)).toHaveCount(2);
  await expect(clearLink(page)).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);
  // The legacy `subject=` only means something where the form has a detail with the id `subject`.
  await page.goto(`${base}?subject=Optics`);
  await expect(items(page)).toHaveCount(2);
  await expect(clearLink(page)).toHaveCount(0);

  // A repeated parameter counts once, the first value.
  await page.goto(`${base}?d_f_sem=o_1&d_f_sem=o_2&type=t_lecture&type=t_lab`);
  await expect.poll(() => titlesShown(page)).toEqual(["Lecture 1"]);
  await expect(semesterFilter).toHaveValue("o_1");

  // A choice written as its label (not its id), an unknown type and huge values match nothing, and say so without showing an id.
  await page.goto(`${base}?d_f_sem=Semester%201`);
  await expect(noMatch(page)).toBeVisible();
  await expect(semesterFilter.locator("option:checked")).toHaveText("Unknown choice");
  await page.goto(`${base}?type=nonsense`);
  await expect(noMatch(page)).toBeVisible();
  await expect(filterType(page).locator("option:checked")).toHaveText("Unknown type");
  expect((await page.goto(`${base}?d_f_sem=${"o".repeat(3000)}&d_f_subject=${"s".repeat(3000)}&type=${"t".repeat(3000)}`))?.status()).toBe(200);
  await expect(noMatch(page)).toBeVisible();
  expect((await page.goto(`${base}?d_f_sem=%00&d_f_subject=%00&type=%00&q=%00`))?.status()).toBe(200);
  await expect(library(page)).toBeVisible();

  // A text detail is matched without regard to capitals.
  await page.goto(`${base}?d_f_subject=OPTICS`);
  await expect.poll(() => titlesShown(page)).toEqual(["Lab report 1"]);
  await expect(library(page).getByLabel("Subject", { exact: true })).toHaveValue("Optics");
});

test("a member uploads to the group's form, only the uploader edits, and the owner can delete", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Class Permissions");
  await setFormConfig(page, group.id, CLASS_FORM);
  const member = await addMember(page, browser, info, group);

  await upload(member, group.path, {
    title: "Ravi's lab",
    type: "Lab record",
    fields: { "Semester (required)": "Semester 3", "Subject (optional)": "Chemistry" },
  });
  await upload(page, group.path, { title: "Owner's lecture", type: "Lecture notes", fields: { "Semester (required)": "Semester 1" } });

  // Both see both files with the details.
  await page.goto(group.path);
  await expect(items(page)).toHaveCount(2);
  await expect(fileLink(page, /Ravi's lab/)).toContainText("Semester: Semester 3");
  await expect(fileLink(page, /Ravi's lab/)).toContainText(MEMBER);

  // The owner cannot edit the member's file, but can delete it; the member cannot edit the owner's.
  await fileLink(page, /Ravi's lab/).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ravi's lab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit details" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete file…" })).toBeVisible();
  await member.goto(group.path);
  await fileLink(member, /Owner's lecture/).click();
  await expect(member.getByRole("heading", { level: 1, name: "Owner's lecture" })).toBeVisible();
  await expect(member.getByRole("heading", { name: "Edit details" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Delete file…" })).toHaveCount(0);

  // The member edits their own file on the group's form: a required choice cannot be emptied.
  await member.goto(group.path);
  await fileLink(member, /Ravi's lab/).click();
  const edit = member.getByRole("region", { name: "Edit details" });
  await edit.getByLabel("Semester (required)", { exact: true }).selectOption({ label: "Choose one" });
  await member.getByRole("button", { name: "Save details" }).click();
  await expect(edit.getByText(FORM_MESSAGES.chooseOne)).toBeVisible();
  await expect(edit.getByLabel("Semester (required)", { exact: true })).toBeFocused();
  await edit.getByLabel("Semester (required)", { exact: true }).selectOption({ label: "Semester 2" });
  await edit.getByLabel("Subject (optional)").fill("");
  await member.getByRole("button", { name: "Save details" }).click();
  await expect(member.getByText(FILE_MESSAGES.saved, { exact: true })).toBeVisible();
  await expect(member.getByTestId("file-meta")).toContainText("Semester: Semester 2");
  await expect(member.getByTestId("file-meta")).not.toContainText("Subject");

  // The owner deletes the member's file.
  await page.getByRole("button", { name: "Delete file…" }).click();
  await page.getByRole("dialog", { name: "Delete Ravi's lab?" }).getByRole("button", { name: "Yes, delete Ravi's lab", exact: true }).click();
  await expect(page).toHaveURL(`${group.path}?notice=deleted`);
  await expect(items(page)).toHaveCount(1);
});

test("the upload form, edit form, file page and filter bar fit the screen and meet the phone quality bar", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Layout Form");
  const longType = "Type label of exactly forty characters.";
  const longDetail = "A detail label of thirty chars";
  const longChoice = "A choice label of exactly forty chars!";
  await setFormConfig(page, group.id, {
    version: 1,
    types: [
      { id: "t_long", label: longType },
      { id: "t_two", label: "Second kind" },
    ],
    fields: [
      { id: "f_long", label: longDetail, kind: "dropdown", required: true, options: [{ id: "o_a", label: longChoice }, { id: "o_b", label: "Short" }] },
      { id: "f_text", label: "Subject", kind: "text", required: false },
      { id: "f_req", label: "Teacher", kind: "text", required: true },
    ],
  });
  const answers = {
    title: `Very-long-title-${"x".repeat(100)}`,
    type: longType,
    fields: { [`${longDetail} (required)`]: longChoice, "Subject (optional)": "Computer-Networks-and-Distributed-Systems", "Teacher (required)": "Dr. Rao" },
  };
  await upload(page, group.path, answers);
  await upload(page, group.path, { ...answers, title: "Second file", type: "Other", other: "Pamphlet-with-a-rather-long-description", fields: { ...answers.fields, "Subject (optional)": "Short" } });

  // The upload form: plain, with Other and its words, and with errors showing.
  await page.goto(`${group.path}/upload`);
  await expect(page.getByLabel("File", { exact: true })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  await typeField(page).selectOption({ label: "Other" });
  await expect(otherField(page)).toBeVisible();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: PDF });
  await uploadButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.otherRequired)).toBeVisible();
  await expect(page.getByText(FORM_MESSAGES.chooseOne)).toBeVisible();
  await expect(page.getByText(FORM_MESSAGES.required).first()).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  // The library and its filter bar (a long choice is chosen, so the select shows it).
  await page.goto(group.path);
  await expect(fileList(page)).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  await page.goto(`${group.path}?q=very&type=t_long&d_f_long=o_a&d_f_text=${encodeURIComponent("Computer-Networks-and-Distributed-Systems")}`);
  await expect(items(page)).toHaveCount(1);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  for (const select of [filterType(page), library(page).getByLabel(longDetail, { exact: true }), library(page).getByLabel("Teacher", { exact: true })]) {
    expect((await select.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }

  // The file page with its edit form, for a file with a long type, choice and details; and for an Other file.
  await fileLink(page, /Very-long-title/).click();
  await expect(page.getByRole("heading", { name: "Edit details" })).toBeVisible();
  await expect(page.getByTestId("file-meta")).toContainText(longType);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  await page.goto(group.path);
  await fileLink(page, /Second file/).click();
  await expect(page.getByTestId("file-meta")).toContainText("Other: Pamphlet-with-a-rather-long-description");
  await expect(page.getByLabel("What kind of file is it?", { exact: true })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  // With errors showing in the edit form.
  await page.getByLabel("What kind of file is it?", { exact: true }).fill("");
  await page.getByLabel("Teacher (required)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(FORM_MESSAGES.otherRequired)).toBeVisible();
  await expect(page.getByText(FORM_MESSAGES.required)).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
});

test("a group on the default form shows the same screens as before and passes the quality bar", async ({ page }) => {
  const group = await setUp(page, "Default Layout");
  await upload(page, group.path, { title: "Unit 1 notes", type: "Notes", fields: { "Subject (optional)": "Physics" } });
  await upload(page, group.path, { title: "Manual", type: "Other", other: "Lab manual" });
  await page.goto(`${group.path}/upload`);
  await expect(page.getByLabel("File", { exact: true })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  await page.goto(group.path);
  await expect(fileList(page)).toBeVisible();
  await auditPage(page);
  await fileLink(page, /Manual/).click();
  await expect(page.getByRole("heading", { name: "Edit details" })).toBeVisible();
  await auditPage(page);
  // Suggestions: the subject the group already uses is offered, by the Subject field of the next upload.
  await page.goto(`${group.path}/upload`);
  const subject = page.getByLabel("Subject (optional)", { exact: true });
  await expect(subject).toHaveAttribute("list", /.+/);
  const listId = (await subject.getAttribute("list")) ?? "";
  await expect(page.locator(`[id="${listId}"] option`)).toHaveCount(1);
  await expect(page.locator(`[id="${listId}"] option`)).toHaveAttribute("value", "Physics");
  // A group's files all still list with their labels.
  await page.goto(group.path);
  await expect(fileLink(page, /Unit 1 notes/)).toContainText("Subject: Physics");
  await expect(fileLink(page, /Manual/)).toContainText("Other: Lab manual");
});

test("a file whose type the form no longer knows shows 'Unknown type' in the edit form and keeps it until the member changes it", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Unknown Type");
  await upload(page, group.path, { title: "Unit 1 notes", type: "Notes" });
  // The group's form is replaced by one that has no record of the Notes type at all.
  await setFormConfig(page, group.id, CLASS_FORM);

  await page.goto(group.path);
  await fileLink(page, /Unit 1 notes/).click();
  const edit = page.getByRole("region", { name: "Edit details" });
  const type = edit.getByLabel("Type", { exact: true });
  await expectOptions(type, ["Lecture notes", "Lab record", "Unknown type", "Other"]);
  await expect(type).toHaveValue("notes");
  await expect(type.locator("option:checked")).toHaveText("Unknown type");

  // Saving something else leaves the type alone (it is not silently switched to the first one).
  await edit.getByLabel("Title", { exact: true }).fill("Unit 1 notes (final)");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(FILE_MESSAGES.saved, { exact: true })).toBeVisible();
  await expect(type).toHaveValue("notes");
  await expect(type.locator("option:checked")).toHaveText("Unknown type");
  await page.reload();
  await expect(edit.getByLabel("Type", { exact: true })).toHaveValue("notes");

  // Choosing a type of the form changes it, and the unknown one is gone for good.
  await edit.getByLabel("Type", { exact: true }).selectOption({ label: "Lab record" });
  await edit.getByLabel("Semester (required)", { exact: true }).selectOption({ label: "Semester 1" });
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("file-meta")).toContainText("Lab record");
  await page.reload();
  await expectOptions(edit.getByLabel("Type", { exact: true }), ["Lecture notes", "Lab record", "Other"]);
});
