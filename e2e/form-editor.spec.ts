import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
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
  The owner's upload form editor (custom upload form, slice 2), as real people in real browsers (fake
  services mode). A starting form is given to a group through the test-only /api/test/set-form-config
  route when a test needs one; everything else goes through the real pages. Files are tiny buffers made
  in memory. Never resets the shared fake store.
*/

const OWNER = "Asha Rao";
const MEMBER = "Ravi Kumar";
const NOT_FOUND_TEXT = "This page could not be found.";

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

/** A group that has one type and no extra details yet. */
const BARE_FORM = { version: 1, types: [{ id: "t_notes", label: "Notes" }], fields: [] };
/** A class group's own form (what the owner built earlier). */
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

const used = (page: Page) => page.getByTestId("fields-used");
const typeList = (page: Page) => page.getByRole("list", { name: "Type options" });
const typeBoxes = (page: Page) => typeList(page).getByRole("textbox");
const detail = (page: Page, number: number) => page.getByRole("group", { name: `Detail ${number}`, exact: true });
const preview = (page: Page) => page.getByTestId("form-preview");
/** The editor's own messages (Next also keeps a route announcer with the alert role elsewhere on the page, filled in after a navigation). */
const alerts = (page: Page) => page.locator("[data-hydrated=true]").getByRole("alert");
const saveButton = (page: Page) => page.getByRole("button", { name: "Save", exact: true });
const addType = (page: Page) => page.getByRole("button", { name: "Add a type" });
const addDetail = (page: Page) => page.getByRole("button", { name: "Add a detail" });
const savedMessage = (page: Page) => page.getByText(/^Saved\. Members see this form/);
const library = (page: Page) => page.getByRole("region", { name: "Library" });
const fileLink = (page: Page, title: string | RegExp) => library(page).getByRole("list", { name: "Files" }).getByRole("link", { name: title });
const typeSelect = (page: Page) => page.getByLabel("Type", { exact: true });
const expectOptions = (select: Locator, expected: string[]) => expect(select.locator("option")).toHaveText(expected);
const values = (boxes: Locator) => boxes.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));

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

/** Opens the editor and waits until it works (the page is hydrated). */
async function openEditor(page: Page, group: { path: string }) {
  await page.goto(`${group.path}/settings/upload-form`);
  await expect(page.getByRole("heading", { level: 2, name: "Upload form" })).toBeVisible();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
}

async function upload(page: Page, groupPath: string, title: string, answers: { type?: string; fields?: Record<string, string> } = {}) {
  await page.goto(`${groupPath}/upload`);
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Title", { exact: true }).fill(title);
  if (answers.type) await typeSelect(page).selectOption({ label: answers.type });
  for (const [label, value] of Object.entries(answers.fields ?? {})) {
    const field = page.getByLabel(label, { exact: true });
    if ((await field.evaluate((node) => node.tagName)) === "SELECT") await field.selectOption({ label: value });
    else await field.fill(value);
  }
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page).toHaveURL(`${groupPath}?notice=uploaded`);
  await expect(fileLink(page, title).first()).toBeVisible();
}

test("the owner reaches the editor from the Group created screen and from Settings", async ({ page }) => {
  await signUpAndConfirm(page, { name: OWNER });
  const group = await createGroupThroughForm(page, { name: "Setup Step", mode: "link", fromHome: true, open: false });

  // The created screen keeps the invite and "Open the group", and adds a prominent first step.
  await expect(page.getByTestId("invite-link")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the group" })).toBeVisible();
  const next = page.getByRole("link", { name: "Next: set up your upload form" });
  expect((await next.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  await next.click();
  await expect(page).toHaveURL(`${group.path}/settings/upload-form`);
  await expect(page.getByRole("heading", { level: 2, name: "Upload form" })).toBeVisible();
  // A new group starts on the default form: Title, Type and an optional Subject.
  await expect(used(page)).toHaveText("3 of 5 fields used");
  expect(await values(typeBoxes(page))).toEqual(["Notes", "Previous year paper", "Study material", "Assignment"]);
  await expect(detail(page, 1).getByLabel("Name of detail 1")).toHaveValue("Subject");
  await expect(detail(page, 1).getByRole("switch", { name: /^Required/ })).not.toBeChecked();
  // The Settings tab stays lit on this page.
  await expect(page.getByRole("navigation", { name: "Group sections" }).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "true");

  // From Settings.
  await page.goto(`${group.path}/settings`);
  await expect(page.getByRole("heading", { level: 2, name: "Upload form" })).toBeVisible();
  await page.getByRole("link", { name: "Edit upload form" }).click();
  await expect(page).toHaveURL(`${group.path}/settings/upload-form`);
  await expect(used(page)).toHaveText("3 of 5 fields used");
  await page.getByRole("link", { name: "Back to settings" }).click();
  await expect(page).toHaveURL(`${group.path}/settings`);
});

test("the owner designs the form, and the member's upload form is exactly that", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Design Form");
  await setFormConfig(page, group.id, BARE_FORM);
  const member = await addMember(page, browser, info, group);

  await openEditor(page, group);
  await expect(used(page)).toHaveText("2 of 5 fields used");
  expect(await values(typeBoxes(page))).toEqual(["Notes"]);

  // A new type: its name box takes the cursor.
  await addType(page).click();
  await expect(page.getByLabel("Type option 2")).toBeFocused();
  await page.getByLabel("Type option 2").fill("Lab record");

  // A required dropdown, Semester, with two choices.
  await addDetail(page).click();
  const semester = detail(page, 1);
  await expect(semester.getByLabel("Name of detail 1")).toBeFocused();
  await semester.getByLabel("Name of detail 1").fill("Semester");
  await semester.getByRole("radio", { name: /Dropdown/ }).check();
  await semester.getByLabel("Choice 1 of Semester").fill("Sem 1");
  await semester.getByLabel("Choice 2 of Semester").fill("Sem 2");
  await semester.getByRole("switch", { name: /^Required/ }).check();

  // An optional text detail, Subject.
  await addDetail(page).click();
  const subject = detail(page, 2);
  await subject.getByLabel("Name of detail 2").fill("Subject");
  await expect(subject.getByRole("radio", { name: /Short text/ })).toBeChecked();
  await expect(subject.getByRole("switch", { name: /^Required/ })).not.toBeChecked();
  await expect(used(page)).toHaveText("4 of 5 fields used");

  // The preview follows the draft, and is only a preview.
  const form = preview(page);
  await expectOptions(form.getByLabel("Type", { exact: true }), ["Notes", "Lab record", "Other"]);
  await expectOptions(form.getByLabel("Semester (required)", { exact: true }), ["Choose one", "Sem 1", "Sem 2"]);
  await expect(form.getByLabel("Subject (optional)", { exact: true })).toBeDisabled();
  await expect(form.getByLabel("What kind of file is it?", { exact: true })).toHaveCount(0);
  await form.getByLabel("Type", { exact: true }).selectOption({ label: "Other" });
  await expect(form.getByLabel("What kind of file is it?", { exact: true })).toBeDisabled();
  await expect(form.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("You have changes that are not saved.")).toBeVisible();

  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await expect(page.getByText("You have changes that are not saved.")).toHaveCount(0);

  // The member's form shows exactly that.
  await member.goto(`${group.path}/upload`);
  await expect(member.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await expectOptions(typeSelect(member), ["Notes", "Lab record", "Other"]);
  const semesterSelect = member.getByLabel("Semester (required)", { exact: true });
  await expectOptions(semesterSelect, ["Choose one", "Sem 1", "Sem 2"]);
  await expect(member.getByLabel("Subject (optional)", { exact: true })).toBeVisible();
  await expect(member.getByLabel(/\((required|optional)\)$/)).toHaveCount(2);
  await expect(member.getByLabel("What kind of file is it?", { exact: true })).toHaveCount(0);
  await typeSelect(member).selectOption({ label: "Other" });
  await expect(member.getByLabel("What kind of file is it?", { exact: true })).toBeVisible();
  await typeSelect(member).selectOption({ label: "Lab record" });

  // The member must choose a semester.
  await member.getByLabel("File", { exact: true }).setInputFiles({ name: "lab.pdf", mimeType: "application/pdf", buffer: PDF });
  await member.getByLabel("Title", { exact: true }).fill("Optics lab");
  await member.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(member.getByText(FORM_MESSAGES.chooseOne)).toBeVisible();
  await expect(semesterSelect).toBeFocused();
  await semesterSelect.selectOption({ label: "Sem 2" });
  await member.getByLabel("Subject (optional)", { exact: true }).fill("Optics");
  await member.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(member).toHaveURL(`${group.path}?notice=uploaded`);
  await expect(fileLink(member, /Optics lab/)).toContainText("Lab record");
  await expect(fileLink(member, /Optics lab/)).toContainText("Semester: Sem 2");
  await expect(fileLink(member, /Optics lab/)).toContainText("Subject: Optics");
});

test("renaming updates old files, removing keeps them marked, and a second save works without reloading", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Rename Form");
  await setFormConfig(page, group.id, CLASS_FORM);
  await upload(page, group.path, "Old lab report", { type: "Lab record", fields: { "Semester (required)": "Semester 2", "Subject (optional)": "Optics" } });

  await openEditor(page, group);
  expect(await values(typeBoxes(page))).toEqual(["Lecture notes", "Lab record"]);

  // Rename the type, the detail and a choice, and save.
  await page.getByLabel("Type option 2").fill("Lab report");
  await detail(page, 1).getByLabel("Name of detail 1").fill("Term");
  await detail(page, 1).getByLabel("Choice 2 of Term").fill("Second term");
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();

  // A second and a third save in the same editor session, without reloading (they use the ids and version the earlier save returned).
  await page.getByLabel("Type option 2").fill("Lab reports");
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await page.getByLabel("Type option 2").fill("Practical");
  await expect(savedMessage(page)).toHaveCount(0);
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await expect(alerts(page)).toHaveCount(0);

  // The old file follows every rename.
  const lib = await page.context().newPage();
  await lib.goto(group.path);
  await expect(fileLink(lib, /Old lab report/)).toContainText("Practical");
  await expect(fileLink(lib, /Old lab report/)).toContainText("Term: Second term");
  await expect(fileLink(lib, /Old lab report/)).toContainText("Subject: Optics");

  // Removing something the saved form has asks first, and says old files keep it. Cancel changes nothing.
  await page.getByRole("button", { name: "Remove Practical" }).click();
  const confirm = page.getByRole("group", { name: /Remove Practical\?/ });
  await expect(confirm).toContainText("Files that already use it keep it. It will not be offered for new uploads.");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Practical" })).toBeFocused();
  expect(await values(typeBoxes(page))).toEqual(["Lecture notes", "Practical"]);

  await page.getByRole("button", { name: "Remove Practical" }).click();
  await page.getByRole("button", { name: "Yes, remove Practical" }).click();
  expect(await values(typeBoxes(page))).toEqual(["Lecture notes"]);
  // The focus went to the neighbour that is left.
  await expect(page.getByLabel("Type option 1")).toBeFocused();
  // A type added in this session (never saved) is removed without a question.
  await addType(page).click();
  await page.getByLabel("Type option 2").fill("Scratch");
  await page.getByRole("button", { name: "Remove Scratch" }).click();
  expect(await values(typeBoxes(page))).toEqual(["Lecture notes"]);
  await expect(page.getByRole("button", { name: "Yes, remove Scratch" })).toHaveCount(0);
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();

  // The old file keeps it, marked; new uploads are not offered it.
  await lib.goto(group.path);
  await expect(fileLink(lib, /Old lab report/)).toContainText("Practical (removed)");
  await lib.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(lib), ["Lecture notes", "Other"]);

  // Adding the same name again makes a new type, and the old file stays with the removed one.
  await addType(page).click();
  await page.getByLabel("Type option 2").fill("Practical");
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await lib.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(lib), ["Lecture notes", "Practical", "Other"]);
  await lib.goto(group.path);
  await expect(fileLink(lib, /Old lab report/)).toContainText("Practical (removed)");
});

test("the limits are refused with a message: a 6th type, a 4th detail, a 16th choice, one choice, a repeated or empty name", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Limits Form");
  await openEditor(page, group);

  // Types: the default form has 4; the fifth is fine, the sixth is not offered.
  await addType(page).click();
  await expect(addType(page)).toBeDisabled();
  await expect(page.getByText(FORM_MESSAGES.tooManyTypes(5))).toBeVisible();
  await expect(addType(page)).toHaveAccessibleDescription(FORM_MESSAGES.tooManyTypes(5));
  // An empty name and a repeated one (ignoring capitals and spaces) are refused when saving, next to the row.
  await page.getByLabel("Type option 5").fill("  NOTES ");
  await saveButton(page).click();
  const fifth = page.getByLabel("Type option 5");
  await expect(page.getByText(FORM_MESSAGES.labelTaken)).toBeVisible();
  await expect(fifth).toHaveAttribute("aria-invalid", "true");
  await expect(fifth).toBeFocused();
  await expect(fifth).toHaveAccessibleDescription(FORM_MESSAGES.labelTaken);
  await expect(alerts(page)).toContainText("Some items need attention");
  await fifth.fill("");
  await saveButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.labelRequired)).toBeVisible();
  await fifth.fill("Other");
  await saveButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.otherReserved)).toBeVisible();
  // Typing in the box takes its message away.
  await fifth.fill("Exam paper");
  await expect(page.getByText(FORM_MESSAGES.otherReserved)).toHaveCount(0);

  // Details: the default form has Subject; two more fit, the fourth is not offered.
  await addDetail(page).click();
  await detail(page, 2).getByLabel("Name of detail 2").fill("Semester");
  await addDetail(page).click();
  await detail(page, 3).getByLabel("Name of detail 3").fill("Year");
  await expect(addDetail(page)).toBeDisabled();
  await expect(page.getByText(FORM_MESSAGES.tooManyDetails(3))).toBeVisible();
  await expect(used(page)).toHaveText("5 of 5 fields used");
  await detail(page, 2).getByRole("radio", { name: /Dropdown/ }).check();

  // Choices: a dropdown with one choice is refused when saving; the 16th is not offered.
  const semester = detail(page, 2);
  await semester.getByLabel("Choice 1 of Semester").fill("Sem 1");
  await semester.getByRole("button", { name: /^Remove choice 2/ }).click();
  await saveButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.tooFewChoices(2))).toBeVisible();
  // The message belongs to the list of choices it is about (a screen reader reads it with the list).
  await expect(semester.getByRole("list", { name: "Choices for Semester" })).toHaveAccessibleDescription(FORM_MESSAGES.tooFewChoices(2));
  await auditPage(page);
  for (let i = 2; i <= 15; i++) {
    await semester.getByRole("button", { name: "Add a choice" }).click();
    await semester.getByLabel(`Choice ${i} of Semester`).fill(`Sem ${i}`);
  }
  await expect(semester.getByRole("button", { name: "Add a choice" })).toBeDisabled();
  await expect(semester.getByText(FORM_MESSAGES.tooManyChoices(15))).toBeVisible();
  await expect(semester.getByRole("list", { name: "Choices for Semester" }).getByRole("listitem")).toHaveCount(15);
  // Two choices with the same name.
  await semester.getByLabel("Choice 15 of Semester").fill("sem 1");
  await saveButton(page).click();
  await expect(semester.getByText(FORM_MESSAGES.labelTaken)).toBeVisible();
  await expect(semester.getByLabel("Choice 15 of Semester")).toBeFocused();
  await semester.getByLabel("Choice 15 of Semester").fill("Sem 15");

  // Everything fixed: it saves, and the counter and the limits still hold.
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await expect(alerts(page)).toHaveCount(0);
  await expect(used(page)).toHaveText("5 of 5 fields used");
  await expect(addType(page)).toBeDisabled();
});

test("Use these defaults only fills the form in; the form changes when it is saved", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Defaults Form");
  await setFormConfig(page, group.id, CLASS_FORM);
  page.on("dialog", (dialog) => void dialog.accept());
  await openEditor(page, group);
  expect(await values(typeBoxes(page))).toEqual(["Lecture notes", "Lab record"]);

  await page.getByRole("button", { name: "Use these defaults" }).click();
  expect(await values(typeBoxes(page))).toEqual(["Notes", "Previous year paper", "Study material", "Assignment"]);
  await expect(detail(page, 1).getByLabel("Name of detail 1")).toHaveValue("Subject");
  await expect(detail(page, 1).getByRole("group", { name: /Choices/ })).toHaveCount(0);
  await expect(used(page)).toHaveText("3 of 5 fields used");
  await expect(page.getByText("Nothing is saved until you choose Save.").first()).toBeVisible();
  await expect(page.getByText("You have changes that are not saved.")).toBeVisible();

  // Nothing was saved: the group's form is still its own, here and on the upload page.
  await page.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(page), ["Lecture notes", "Lab record", "Other"]);
  await openEditor(page, group);
  expect(await values(typeBoxes(page))).toEqual(["Lecture notes", "Lab record"]);

  // Saved, it is the form.
  await page.getByRole("button", { name: "Use these defaults" }).click();
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await page.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(page), ["Notes", "Previous year paper", "Study material", "Assignment", "Other"]);
  await expect(page.getByLabel("Subject (optional)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Semester (required)", { exact: true })).toHaveCount(0);
});

test("leaving with unsaved changes asks first; moving, adding and removing keep the keyboard where it was", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Keyboard Form");
  await openEditor(page, group);

  // Up and down buttons work from the keyboard and keep the focus on the moved row's button.
  const down = page.getByRole("button", { name: "Move Notes down" });
  await down.focus();
  await page.keyboard.press("Enter");
  expect(await values(typeBoxes(page))).toEqual(["Previous year paper", "Notes", "Study material", "Assignment"]);
  await expect(page.getByRole("button", { name: "Move Notes down" })).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  expect(await values(typeBoxes(page))).toEqual(["Previous year paper", "Study material", "Assignment", "Notes"]);
  // At the end the down button is off, so the focus goes to the up button.
  await expect(page.getByRole("button", { name: "Move Notes down" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Notes up" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await values(typeBoxes(page))).toEqual(["Previous year paper", "Study material", "Notes", "Assignment"]);
  await expect(page.getByRole("button", { name: "Move Notes up" })).toBeFocused();
  // The first row cannot go up.
  await expect(page.getByRole("button", { name: "Move Previous year paper up" })).toBeDisabled();

  // A details card moves too.
  await addDetail(page).click();
  await detail(page, 2).getByLabel("Name of detail 2").fill("Year");
  await page.getByRole("button", { name: "Move Year up" }).click();
  await expect(detail(page, 1).getByLabel("Name of detail 1")).toHaveValue("Year");
  await expect(page.getByRole("button", { name: "Move Year up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Year down" })).toBeFocused();

  // Closing the page asks first while there are unsaved changes (the dialog is the browser's own).
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toContain("beforeunload");

  // Following a link inside the app asks too: Stay keeps the editor, Leave goes.
  const second = await page.context().newPage();
  await second.goto(`${group.path}/settings/upload-form`);
  await expect(second.locator("[data-hydrated=true]")).toBeVisible();
  await second.getByLabel("Type option 1").fill("Changed");
  const asked: string[] = [];
  second.once("dialog", (dialog) => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  await second.getByRole("link", { name: "Back to settings" }).click();
  await expect.poll(() => asked).toEqual(["confirm"]);
  await expect(second).toHaveURL(`${group.path}/settings/upload-form`);
  await expect(second.getByLabel("Type option 1")).toHaveValue("Changed");
  second.once("dialog", (dialog) => void dialog.accept());
  await second.getByRole("link", { name: "Back to settings" }).click();
  await expect(second).toHaveURL(`${group.path}/settings`);

  // Once saved, there is nothing to ask.
  await openEditor(second, group);
  await second.getByLabel("Type option 1").fill("Changed");
  await saveButton(second).click();
  await expect(savedMessage(second)).toBeVisible();
  second.on("dialog", (dialog) => {
    asked.push(`unexpected ${dialog.type()}`);
    void dialog.dismiss();
  });
  await second.getByRole("link", { name: "Back to settings" }).click();
  await expect(second).toHaveURL(`${group.path}/settings`);
  expect(asked).toEqual(["confirm"]);
});

test("a member and a stranger cannot open the editor or save a form, and nothing changes", async ({ page, browser }, info) => {
  test.slow();
  const group = await setUp(page, "Private Form");
  await setFormConfig(page, group.id, CLASS_FORM);
  const member = await addMember(page, browser, info, group);
  const stranger = await newPersonContext(browser, info, page, "Sana Mirza");
  extraContexts.push(stranger.context);

  // The same plain not-found page as for an address that leads nowhere.
  const notFoundAt = async (who: Page, path: string) => {
    await who.goto(path);
    await expect(who.getByText(NOT_FOUND_TEXT)).toBeVisible();
    return who.locator("body").innerText();
  };
  const madeUp = await notFoundAt(member, "/groups/6f1c2b9e-3d4a-4f5b-8c7d-9e0a1b2c3d4e/settings/upload-form");
  expect(await notFoundAt(member, `${group.path}/settings/upload-form`)).toBe(madeUp);
  await notFoundAt(stranger.page, `${group.path}/settings/upload-form`);
  // ...and a plain member sees no link to it either.
  await member.goto(`${group.path}/upload`);
  await expect(member.getByRole("link", { name: /upload form/i })).toHaveCount(0);

  // The owner saves once, and the request is kept to be sent again by someone else.
  await openEditor(page, group);
  await page.getByLabel("Type option 1").fill("Lectures");
  const sent = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"]);
  await saveButton(page).click();
  const request = await sent;
  await expect(savedMessage(page)).toBeVisible();
  const [groupId, draft] = JSON.parse(request.postData() ?? "[]") as [string, { version: number; types: { id: string; label: string }[] }];
  expect(groupId).toBe(group.id);

  // The member (a hand-made post with the same action) is refused as if the group were not there. The draft is perfectly fine.
  const replay = async (who: Page, label: string) => {
    const response = await who.request.post(request.url(), {
      headers: { "next-action": request.headers()["next-action"]!, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" },
      data: JSON.stringify([group.id, { ...draft, version: 2, types: [{ ...draft.types[0], label }, ...draft.types.slice(1)] }]),
    });
    return response.text();
  };
  const refused = await replay(member, "Hacked by member");
  expect(refused).toContain(FORM_MESSAGES.notAvailable);
  expect(refused).not.toContain("Hacked by member");
  expect(await replay(stranger.page, "Hacked by stranger")).toContain(FORM_MESSAGES.notAvailable);
  // The same post from the owner reaches the use-case (this one is accepted because it is current), so the check above was not vacuous.
  expect(await replay(page, "Lectures again")).not.toContain(FORM_MESSAGES.notAvailable);

  await member.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(member), ["Lectures again", "Lab record", "Other"]);
});

test("two tabs: the second save says the form changed elsewhere and keeps what was typed", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Two Tabs");
  await setFormConfig(page, group.id, CLASS_FORM);
  await openEditor(page, group);
  const other = await page.context().newPage();
  await openEditor(other, group);

  await page.getByLabel("Type option 1").fill("Lectures");
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();

  await other.getByLabel("Type option 2").fill("Labs");
  await saveButton(other).click();
  await expect(alerts(other)).toContainText(FORM_MESSAGES.formChangedElsewhere);
  await expect(savedMessage(other)).toHaveCount(0);
  // What was typed stays on the screen, and nothing of it was saved.
  await expect(other.getByLabel("Type option 2")).toHaveValue("Labs");
  other.on("dialog", (dialog) => void dialog.accept());
  await openEditor(other, group);
  expect(await values(typeBoxes(other))).toEqual(["Lectures", "Lab record"]);
  await other.getByLabel("Type option 2").fill("Labs");
  await saveButton(other).click();
  await expect(savedMessage(other)).toBeVisible();
  await page.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(page), ["Lectures", "Labs", "Other"]);
});

test("the editor fits a 360px screen and meets the phone quality bar, with errors, a question and the preview", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Layout Editor");
  const long = (prefix: string, length: number) => `${prefix}${"x".repeat(length - prefix.length)}`;
  await setFormConfig(page, group.id, {
    version: 1,
    types: ["a", "b", "c", "d", "e"].map((id) => ({ id: `t_${id}`, label: long(`Type ${id} `, 40) })),
    fields: [
      {
        id: "f_long",
        label: long("Detail one ", 30),
        kind: "dropdown",
        required: true,
        options: Array.from({ length: 15 }, (_, i) => ({ id: `o_${i}`, label: long(`Choice ${i + 1} `, 40) })),
      },
      { id: "f_text", label: "Subject", kind: "text", required: false },
      { id: "f_req", label: long("Teacher ", 30), kind: "text", required: true },
    ],
  });

  await openEditor(page, group);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  // The preview with Other chosen.
  await preview(page).getByLabel("Type", { exact: true }).selectOption({ label: "Other" });
  await expect(preview(page).getByLabel("What kind of file is it?", { exact: true })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);

  // The remove question open on a long name.
  await page.getByRole("button", { name: /^Remove Type a / }).click();
  await expect(page.getByRole("group", { name: /^Remove Type a .*\?/ })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  // With errors showing: an empty name, a repeated name, an empty choice, and the limit notes.
  await page.getByLabel("Type option 1").fill("");
  await page.getByLabel("Type option 2").fill("TYPE c " + "x".repeat(33));
  await page.getByLabel("Type option 3").fill("type c " + "x".repeat(33));
  await detail(page, 1).getByLabel("Choice 3 of " + long("Detail one ", 30)).fill("");
  await detail(page, 3).getByLabel("Name of detail 3").fill("");
  await saveButton(page).click();
  await expect(page.getByText(FORM_MESSAGES.labelRequired).first()).toBeVisible();
  await expect(page.getByText(FORM_MESSAGES.labelTaken)).toBeVisible();
  await expect(alerts(page)).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await auditPage(page);
  for (const button of [saveButton(page), page.getByRole("button", { name: "Use these defaults" }), addType(page), page.getByLabel("Type option 1")]) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
  for (const button of [page.getByRole("button", { name: "Move Type d " + "x".repeat(33) + " down" }), page.getByRole("button", { name: /^Remove Type d / })]) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});

test("nothing can be edited while a save is on its way, and what was typed is what gets saved", async ({ page }) => {
  test.slow();
  const group = await setUp(page, "Slow Save");
  await openEditor(page, group);

  // The save's answer is held back until the test lets it through.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${group.path}/settings/upload-form`, async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    await gate;
    return route.continue();
  });

  await addType(page).click();
  await page.getByLabel("Type option 5").fill("  Exam paper ");
  await saveButton(page).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  for (const control of [page.getByLabel("Type option 1"), page.getByLabel("Type option 5"), addType(page), addDetail(page), page.getByRole("button", { name: "Move Notes down" })]) {
    await expect(control).toBeDisabled();
  }
  release();
  await expect(savedMessage(page)).toBeVisible();
  await expect(page.getByLabel("Type option 5")).toBeEnabled();
  await expect(page.getByLabel("Type option 5")).toHaveValue("Exam paper");
  await expect(page.getByText("You have changes that are not saved.")).toHaveCount(0);

  // The new type has its id now: a second save renames it instead of adding another one.
  await page.getByLabel("Type option 5").fill("Exam papers");
  await saveButton(page).click();
  await expect(savedMessage(page)).toBeVisible();
  await page.unroute(`**${group.path}/settings/upload-form`);
  await page.goto(`${group.path}/upload`);
  await expectOptions(typeSelect(page), ["Notes", "Previous year paper", "Study material", "Assignment", "Exam papers", "Other"]);
});
