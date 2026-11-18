import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_CONFIG,
  FORM_LIMITS,
  FORM_MESSAGES,
  isFormConfig,
  parseFormConfig,
  prepareConfigForSave,
  type DraftFormConfig,
  type FormConfig,
} from "./form-config";

/** A class group's form: a required dropdown with a removed choice, an optional text, a removed type and a removed detail. */
const CURRENT: FormConfig = {
  version: 3,
  types: [
    { id: "notes", label: "Notes" },
    { id: "lab", label: "Lab report" },
    { id: "old_quiz", label: "Quiz", archived: true },
  ],
  fields: [
    {
      id: "semester",
      label: "Semester",
      kind: "dropdown",
      required: true,
      options: [
        { id: "s1", label: "Semester 1" },
        { id: "s2", label: "Semester 2" },
        { id: "s0", label: "Semester Zero", archived: true },
      ],
    },
    { id: "subject", label: "Subject", kind: "text", required: false },
    { id: "year", label: "Year", kind: "text", required: true, archived: true },
  ],
};

/** What the editor sends for a config it has not changed: the ACTIVE items only. */
const draftOf = (config: FormConfig): DraftFormConfig => ({
  version: config.version,
  types: config.types.filter((t) => !t.archived).map((t) => ({ id: t.id, label: t.label })),
  fields: config.fields
    .filter((f) => !f.archived)
    .map((f) => ({
      id: f.id,
      label: f.label,
      kind: f.kind,
      required: f.required,
      ...(f.kind === "dropdown" ? { options: (f.options ?? []).filter((o) => !o.archived).map((o) => ({ id: o.id, label: o.label })) } : {}),
    })),
});

const untouched = () => draftOf(CURRENT);

/** A newId that hands out n1, n2, ... */
function counter() {
  let n = 0;
  return () => `n${++n}`;
}

function save(draft: DraftFormConfig, current: FormConfig = CURRENT, newId: () => string = counter()) {
  return prepareConfigForSave(current, draft, newId);
}

function saved(draft: DraftFormConfig, current: FormConfig = CURRENT, newId?: () => string) {
  const result = save(draft, current, newId);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.config;
}

function refused(draft: unknown, current: FormConfig = CURRENT) {
  const result = prepareConfigForSave(current, draft as DraftFormConfig, counter());
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.config)}`);
  return result;
}

const types = (labels: string[]) => labels.map((label, i) => ({ id: "", label: label || `T${i}` }));
const withTypes = (t: DraftFormConfig["types"]): DraftFormConfig => ({ ...untouched(), types: t });
const withFields = (f: DraftFormConfig["fields"]): DraftFormConfig => ({ ...untouched(), fields: f });
const semester = (over: Partial<DraftFormConfig["fields"][number]> = {}): DraftFormConfig["fields"][number] => ({
  ...untouched().fields[0],
  ...over,
});

describe("prepareConfigForSave: a good draft", () => {
  it("keeps an untouched form, bumps the version by one and keeps removed items after the active ones", () => {
    const config = saved(untouched());
    expect(config).toEqual({
      version: 4,
      types: [
        { id: "notes", label: "Notes" },
        { id: "lab", label: "Lab report" },
        { id: "old_quiz", label: "Quiz", archived: true },
      ],
      fields: [
        {
          id: "semester",
          label: "Semester",
          kind: "dropdown",
          required: true,
          options: [
            { id: "s1", label: "Semester 1" },
            { id: "s2", label: "Semester 2" },
            { id: "s0", label: "Semester Zero", archived: true },
          ],
        },
        { id: "subject", label: "Subject", kind: "text", required: false },
        { id: "year", label: "Year", kind: "text", required: true, archived: true },
      ],
    });
  });

  it("gives the default form's draft a version bump too (a first save on a new group)", () => {
    const config = saved(draftOf(DEFAULT_FORM_CONFIG), DEFAULT_FORM_CONFIG);
    expect(config.version).toBe(2);
    expect(config.types.map((t) => t.id)).toEqual(["notes", "pyq", "study_material", "assignment"]);
  });

  it("renames keep the id, and a reorder is kept", () => {
    const draft = untouched();
    draft.types = [{ id: "lab", label: "Lab write-up" }, { id: "notes", label: "Notes" }];
    const config = saved(draft);
    expect(config.types.slice(0, 2)).toEqual([{ id: "lab", label: "Lab write-up" }, { id: "notes", label: "Notes" }]);
  });

  it("tidies labels: whitespace runs become one space and the ends are trimmed", () => {
    const draft = untouched();
    draft.types = [{ id: "notes", label: "  Class \t  notes\n" }];
    expect(saved(draft).types[0]).toEqual({ id: "notes", label: "Class notes" });
  });

  it("accepts labels of exactly the maximum length (counted in characters people see)", () => {
    const draft = untouched();
    draft.types = [{ id: "", label: "t".repeat(FORM_LIMITS.maxTypeLabel) }, { id: "", label: "😀".repeat(FORM_LIMITS.maxTypeLabel - 1) + "x" }];
    draft.fields = [semester({ label: "d".repeat(FORM_LIMITS.maxDetailLabel), options: [{ id: "", label: "c".repeat(FORM_LIMITS.maxChoiceLabel) }, { id: "s1", label: "One" }] })];
    expect(save(draft).ok).toBe(true);
  });

  it("accepts the largest form: 5 types, 3 details, 15 choices", () => {
    const draft: DraftFormConfig = {
      version: 3,
      types: Array.from({ length: 5 }, (_, i) => ({ id: "", label: `Type ${i}` })),
      fields: Array.from({ length: 3 }, (_, f) => ({
        id: "",
        label: `Detail ${f}`,
        kind: "dropdown" as const,
        required: f === 0,
        options: Array.from({ length: 15 }, (_, o) => ({ id: "", label: `Choice ${o}` })),
      })),
    };
    const config = saved(draft);
    expect(config.types.filter((t) => !t.archived)).toHaveLength(5);
    expect(config.fields.filter((f) => !f.archived)).toHaveLength(3);
    // 5 types and every one of the old removed ones, kept.
    expect(config.types).toHaveLength(5 + 3);
  });

  it("allows a form with no type options (Other is always there) and a detail removed entirely", () => {
    const config = saved({ version: 3, types: [], fields: [] });
    expect(config.types.every((t) => t.archived)).toBe(true);
    expect(config.fields.every((f) => f.archived)).toBe(true);
  });

  it("returns something parseFormConfig reads back unchanged", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "Slides" });
    draft.fields.push({ id: "", label: "Topic", kind: "text", required: false });
    const config = saved(draft);
    expect(parseFormConfig(config)).toEqual(config);
  });

  it("does not change what it was given, and shares nothing with the draft", () => {
    const current = structuredClone(CURRENT);
    const draft = untouched();
    const before = structuredClone({ current, draft });
    const config = saved(draft, current);
    expect({ current, draft }).toEqual(before);
    expect(config.types[0]).not.toBe(draft.types[0]);
    expect(config.fields[0]).not.toBe(CURRENT.fields[0]);
    expect(config.fields[0].options).not.toBe(CURRENT.fields[0].options);
  });

  it("ignores extra properties a hostile client adds to items", () => {
    const draft = untouched();
    (draft.types[0] as Record<string, unknown>).archived = true;
    (draft.types[0] as Record<string, unknown>).extra = "x";
    (draft.fields[1] as Record<string, unknown>).archived = true;
    const config = saved(draft);
    expect(config.types[0]).toEqual({ id: "notes", label: "Notes" });
    expect(config.fields[1]).toEqual({ id: "subject", label: "Subject", kind: "text", required: false });
  });
});

describe("prepareConfigForSave: new items and ids", () => {
  it("gives every new item a generated id, types first, then each detail followed by its choices", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "Slides" });
    draft.fields = [
      ...draft.fields,
      { id: "", label: "Year", kind: "dropdown", required: false, options: [{ id: "", label: "2024" }, { id: "", label: "2025" }] },
    ];
    const config = saved(draft, CURRENT, counter());
    expect(config.types.find((t) => t.label === "Slides")?.id).toBe("n1");
    const year = config.fields.find((f) => f.label === "Year");
    expect(year).toEqual({
      id: "n2",
      label: "Year",
      kind: "dropdown",
      required: false,
      options: [{ id: "n3", label: "2024" }, { id: "n4", label: "2025" }],
    });
  });

  it("retries when the generated id is already used in that list (also by a removed item) or is reserved", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "Slides" });
    const queue = ["notes", "old_quiz", "other", "__proto__", "", "x".repeat(65), "lab", "fresh"];
    expect(saved(draft, CURRENT, () => queue.shift() ?? "never").types.find((t) => t.label === "Slides")?.id).toBe("fresh");

    const two = untouched();
    two.types.push({ id: "", label: "A" }, { id: "", label: "B" });
    const same = ["z1", "z1", "z2"];
    const config = saved(two, CURRENT, () => same.shift() ?? "never");
    expect(config.types.filter((t) => t.label === "A" || t.label === "B").map((t) => t.id)).toEqual(["z1", "z2"]);
  });

  it("the same id may be used in different lists", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "A" });
    draft.fields[1] = { id: "", label: "B", kind: "text", required: false };
    const config = saved(draft, CURRENT, () => "same");
    expect(config.types.some((t) => t.id === "same")).toBe(true);
    expect(config.fields.some((f) => f.id === "same")).toBe(true);
  });

  it("gives up with a plain message when no usable id can be made", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "Slides" });
    const stuck = prepareConfigForSave(CURRENT, draft, () => "notes");
    expect(stuck).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.couldNotSave });
  });

  it("re-adding a removed label creates a NEW item and leaves the removed one", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "quiz" });
    const config = saved(draft, CURRENT, () => "newquiz");
    expect(config.types.find((t) => t.id === "newquiz")).toEqual({ id: "newquiz", label: "quiz" });
    expect(config.types.find((t) => t.id === "old_quiz")).toEqual({ id: "old_quiz", label: "Quiz", archived: true });
  });

  it("the default generator makes short, distinct ids", () => {
    const draft = untouched();
    draft.types.push({ id: "", label: "A" }, { id: "", label: "B" });
    const config = prepareConfigForSave(CURRENT, draft);
    if (!config.ok) throw new Error("expected ok");
    const ids = config.config.types.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !["notes", "lab", "old_quiz"].includes(id)).every((id) => /^[0-9a-f]{8}$/.test(id))).toBe(true);
  });
});

describe("prepareConfigForSave: removing", () => {
  it("archives an active type, detail and choice that the draft leaves out, after the active ones, never deleting", () => {
    const draft = untouched();
    draft.types = [{ id: "lab", label: "Lab report" }]; // notes dropped
    draft.fields = [semester({ options: [{ id: "s2", label: "Semester 2" }, { id: "", label: "Semester 3" }] })]; // subject dropped, s1 dropped
    const config = saved(draft, CURRENT, () => "s3id");
    expect(config.types).toEqual([
      { id: "lab", label: "Lab report" },
      { id: "notes", label: "Notes", archived: true },
      { id: "old_quiz", label: "Quiz", archived: true },
    ]);
    expect(config.fields.map((f) => [f.id, Boolean(f.archived)])).toEqual([
      ["semester", false],
      ["subject", true],
      ["year", true],
    ]);
    expect(config.fields[0].options).toEqual([
      { id: "s2", label: "Semester 2" },
      { id: "s3id", label: "Semester 3" },
      { id: "s1", label: "Semester 1", archived: true },
      { id: "s0", label: "Semester Zero", archived: true },
    ]);
    // A removed detail keeps everything it had.
    expect(config.fields[1]).toEqual({ id: "subject", label: "Subject", kind: "text", required: false, archived: true });
  });

  it("keeps the removed detail's own choices as they were", () => {
    const draft = untouched();
    draft.fields = [];
    const config = saved(draft);
    expect(config.fields[0]).toEqual({ ...CURRENT.fields[0], archived: true });
  });

  it("keeps at most 30 removed items per list; going over asks the owner to tidy up", () => {
    const old = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: `Removed ${i}`, archived: true }));
    const full: FormConfig = {
      version: 1,
      types: [{ id: "a", label: "A" }, ...old(FORM_LIMITS.maxRemoved)],
      fields: [
        {
          id: "f",
          label: "F",
          kind: "dropdown",
          required: false,
          options: [{ id: "o1", label: "One" }, { id: "o2", label: "Two" }, { id: "o3", label: "Three" }, ...old(FORM_LIMITS.maxRemoved)],
        },
      ],
    };
    // Nothing newly removed: still fine at exactly 30.
    expect(save(draftOf(full), full).ok).toBe(true);

    const dropType = draftOf(full);
    dropType.types = [];
    expect(refused(dropType, full).errors).toEqual({ types: FORM_MESSAGES.tooManyRemoved(FORM_LIMITS.maxRemoved) });

    const dropChoice = draftOf(full);
    dropChoice.fields[0].options = [{ id: "o1", label: "One" }, { id: "o2", label: "Two" }];
    expect(refused(dropChoice, full).errors).toEqual({ "field:0:options": FORM_MESSAGES.tooManyRemoved(FORM_LIMITS.maxRemoved) });

    const dropField = draftOf(full);
    dropField.fields = [];
    const withManyFields: FormConfig = { ...full, fields: [...full.fields, ...old(FORM_LIMITS.maxRemoved).map((o) => ({ id: `rf${o.id}`, label: o.label, kind: "text" as const, required: false, archived: true }))] };
    expect(refused({ ...draftOf(withManyFields), fields: [] }, withManyFields).errors).toEqual({ fields: FORM_MESSAGES.tooManyRemoved(FORM_LIMITS.maxRemoved) });
  });
});

describe("prepareConfigForSave: a stale version", () => {
  it("saves nothing and says the form changed elsewhere", () => {
    for (const version of [2, 4, 0, -1, 99]) {
      expect(save({ ...untouched(), version })).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.formChangedElsewhere });
    }
  });

  it("a stale draft is stale even when it is also invalid", () => {
    expect(save({ ...withTypes(types(["", "", "", "", "", ""])), version: 1 })).toEqual({
      ok: false,
      errors: {},
      formError: FORM_MESSAGES.formChangedElsewhere,
    });
  });

  it("refuses a draft whose version is not a number with a form-level message", () => {
    for (const version of ["3", null, undefined, NaN, {}]) {
      const result = refused({ ...untouched(), version });
      expect(result.errors).toEqual({});
      expect(result.formError).toBeTruthy();
    }
  });
});

describe("prepareConfigForSave: a hostile draft is refused with field-level messages", () => {
  it("duplicate labels that differ only by capitals or spaces", () => {
    const result = refused(withTypes([{ id: "notes", label: "Notes" }, { id: "lab", label: "  nOTES " }, { id: "", label: "No  tes" }, { id: "", label: "n o t e s" }]));
    expect(result.errors).toEqual({ "type:1": FORM_MESSAGES.labelTaken });
    expect(refused(withTypes([{ id: "", label: "Slides" }, { id: "", label: "SLIDES" }, { id: "", label: "slides" }])).errors).toEqual({
      "type:1": FORM_MESSAGES.labelTaken,
      "type:2": FORM_MESSAGES.labelTaken,
    });
    expect(refused(withFields([{ id: "", label: "Topic", kind: "text", required: false }, { id: "", label: " topic", kind: "text", required: true }])).errors).toEqual({
      "field:1:label": FORM_MESSAGES.labelTaken,
    });
    expect(refused(withFields([semester({ options: [{ id: "s1", label: "Sem 1" }, { id: "s2", label: "sem  1" }] })])).errors).toEqual({
      "field:0:option:1": FORM_MESSAGES.labelTaken,
    });
  });

  it("a label equal to a removed item's label is fine (it is a new item)", () => {
    expect(save(withTypes([{ id: "", label: "QUIZ" }])).ok).toBe(true);
    expect(save(withFields([semester({ options: [{ id: "s1", label: "One" }, { id: "", label: "semester zero" }] })])).ok).toBe(true);
  });

  it("the same label in different lists is fine", () => {
    expect(save(withFields([semester({ label: "Notes" })])).ok).toBe(true);
  });

  it("an empty or blank label", () => {
    expect(refused(withTypes([{ id: "notes", label: "" }, { id: "", label: "   " }, { id: "", label: "\n\t" }])).errors).toEqual({
      "type:0": FORM_MESSAGES.labelRequired,
      "type:1": FORM_MESSAGES.labelRequired,
      "type:2": FORM_MESSAGES.labelRequired,
    });
    expect(refused(withFields([semester({ label: "" })])).errors).toEqual({ "field:0:label": FORM_MESSAGES.labelRequired });
    expect(refused(withFields([semester({ options: [{ id: "s1", label: "" }, { id: "s2", label: "Two" }] })])).errors).toEqual({
      "field:0:option:0": FORM_MESSAGES.labelRequired,
    });
  });

  it("overlong labels", () => {
    expect(refused(withTypes([{ id: "", label: "t".repeat(41) }])).errors).toEqual({ "type:0": FORM_MESSAGES.tooLong(40) });
    expect(refused(withFields([semester({ label: "d".repeat(31) })])).errors).toEqual({ "field:0:label": FORM_MESSAGES.tooLong(30) });
    expect(
      refused(withFields([semester({ options: [{ id: "s1", label: "c".repeat(41) }, { id: "s2", label: "Two" }] })])).errors,
    ).toEqual({ "field:0:option:0": FORM_MESSAGES.tooLong(40) });
    expect(refused(withTypes([{ id: "", label: "x".repeat(100_000) }])).errors).toEqual({ "type:0": FORM_MESSAGES.tooLong(40) });
    // An emoji is one character, but 41 of them are too many.
    expect(refused(withTypes([{ id: "", label: "😀".repeat(41) }])).errors).toEqual({ "type:0": FORM_MESSAGES.tooLong(40) });
  });

  it("control characters and broken text", () => {
    for (const label of ["a\u0000b", "a\u0007b", "bad\ud800", "\udc00x"]) {
      expect(refused(withTypes([{ id: "", label }])).errors, JSON.stringify(label)).toEqual({ "type:0": FORM_MESSAGES.oddCharacter });
    }
  });

  it("labels that are not text", () => {
    for (const label of [null, undefined, 5, {}, [], true]) {
      expect(refused(withTypes([{ id: "", label } as never])).errors).toEqual({ "type:0": FORM_MESSAGES.labelRequired });
    }
  });

  it("'Other' as a type label (the fixed row is added for you)", () => {
    expect(refused(withTypes([{ id: "", label: " other " }])).errors).toEqual({ "type:0": FORM_MESSAGES.otherReserved });
    expect(save(withTypes([{ id: "", label: "Other notes" }])).ok).toBe(true);
    // A detail or a choice may be called Other.
    expect(save(withFields([semester({ options: [{ id: "s1", label: "Other" }, { id: "s2", label: "Two" }] })])).ok).toBe(true);
  });

  it("6 types, 4 details, and a dropdown with 16 choices", () => {
    expect(refused(withTypes(types(["a", "b", "c", "d", "e", "f"]))).errors).toEqual({ types: FORM_MESSAGES.tooManyTypes(5) });
    expect(save(withTypes(types(["a", "b", "c", "d", "e"]))).ok).toBe(true);

    const four = ["A", "B", "C", "D"].map((label) => ({ id: "", label, kind: "text" as const, required: false }));
    expect(refused(withFields(four)).errors).toEqual({ fields: FORM_MESSAGES.tooManyDetails(3) });
    expect(save(withFields(four.slice(0, 3))).ok).toBe(true);

    const choices = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "", label: `C${i}` }));
    expect(refused(withFields([semester({ options: choices(16) })])).errors).toEqual({ "field:0:options": FORM_MESSAGES.tooManyChoices(15) });
    expect(save(withFields([semester({ options: choices(15) })])).ok).toBe(true);
  });

  it("limits count active items only: the removed ones do not count", () => {
    // The class form already holds 1 removed type, 1 removed detail, 1 removed choice; a full active set still fits.
    const draft = withTypes(types(["a", "b", "c", "d", "e"]));
    expect(save(draft).ok).toBe(true);
  });

  it("a dropdown with fewer than 2 active choices", () => {
    expect(refused(withFields([semester({ options: [{ id: "s1", label: "One" }] })])).errors).toEqual({ "field:0:options": FORM_MESSAGES.tooFewChoices(2) });
    expect(refused(withFields([semester({ options: [] })])).errors).toEqual({ "field:0:options": FORM_MESSAGES.tooFewChoices(2) });
    expect(refused(withFields([semester({ options: undefined })])).errors).toEqual({ "field:0:options": FORM_MESSAGES.tooFewChoices(2) });
    expect(refused(withFields([{ id: "", label: "New", kind: "dropdown", required: false }])).errors).toEqual({ "field:0:options": FORM_MESSAGES.tooFewChoices(2) });
    // Removed choices do not count toward the 2.
    expect(save(withFields([semester({ options: [{ id: "s1", label: "One" }, { id: "s2", label: "Two" }] })])).ok).toBe(true);
  });

  it("a text detail may not carry choices", () => {
    expect(refused(withFields([{ id: "subject", label: "Subject", kind: "text", required: false, options: [{ id: "", label: "x" }] }])).errors).toEqual({
      "field:0:options": FORM_MESSAGES.textHasChoices,
    });
    expect(save(withFields([{ id: "subject", label: "Subject", kind: "text", required: false, options: [] }])).ok).toBe(true);
  });

  it("a changed kind", () => {
    expect(refused(withFields([{ id: "subject", label: "Subject", kind: "dropdown", required: false, options: [{ id: "", label: "A" }, { id: "", label: "B" }] }])).errors).toEqual({
      "field:0:label": FORM_MESSAGES.kindLocked,
    });
    expect(refused(withFields([semester({ kind: "text", options: undefined })])).errors).toEqual({ "field:0:label": FORM_MESSAGES.kindLocked });
  });

  it("a kind that is neither text nor dropdown, and a required that is not a boolean", () => {
    expect(refused(withFields([{ id: "", label: "N", kind: "number", required: false } as never])).errors).toEqual({ "field:0:label": FORM_MESSAGES.badDraft });
    expect(refused(withFields([{ id: "", label: "N", kind: "text", required: "yes" } as never])).errors).toEqual({ "field:0:label": FORM_MESSAGES.badDraft });
  });

  it("an id that does not exist in the current config", () => {
    expect(refused(withTypes([{ id: "ghost", label: "Ghost" }])).errors).toEqual({ "type:0": FORM_MESSAGES.itemUnknown });
    expect(refused(withFields([{ id: "ghost", label: "Ghost", kind: "text", required: false }])).errors).toEqual({ "field:0:label": FORM_MESSAGES.itemUnknown });
    expect(refused(withFields([semester({ options: [{ id: "ghost", label: "Ghost" }, { id: "s2", label: "Two" }] })])).errors).toEqual({
      "field:0:option:0": FORM_MESSAGES.itemUnknown,
    });
  });

  it("a removed item's id is not brought back by a draft (no restore)", () => {
    expect(refused(withTypes([{ id: "old_quiz", label: "Quiz" }])).errors).toEqual({ "type:0": FORM_MESSAGES.itemUnknown });
    expect(refused(withFields([{ id: "year", label: "Year", kind: "text", required: false }])).errors).toEqual({ "field:0:label": FORM_MESSAGES.itemUnknown });
    expect(refused(withFields([semester({ options: [{ id: "s0", label: "Zero" }, { id: "s1", label: "One" }] })])).errors).toEqual({
      "field:0:option:0": FORM_MESSAGES.itemUnknown,
    });
  });

  it("'other', '__proto__', 'constructor' and the like as ids", () => {
    for (const id of ["other", "__proto__", "constructor", "toString", "hasOwnProperty", " notes", "NOTES", "notes ", "x".repeat(10_000)]) {
      expect(refused(withTypes([{ id, label: "Anything" }])).errors, id.slice(0, 20)).toEqual({ "type:0": FORM_MESSAGES.itemUnknown });
      expect(refused(withFields([{ id, label: "Anything", kind: "text", required: false }])).errors, id.slice(0, 20)).toEqual({
        "field:0:label": FORM_MESSAGES.itemUnknown,
      });
      expect(refused(withFields([semester({ options: [{ id, label: "A" }, { id: "s2", label: "Two" }] })])).errors, id.slice(0, 20)).toEqual({
        "field:0:option:0": FORM_MESSAGES.itemUnknown,
      });
    }
  });

  it("an id that is not text", () => {
    for (const id of [null, undefined, 5, {}, []]) {
      expect(refused(withTypes([{ id, label: "Anything" } as never])).errors).toEqual({ "type:0": FORM_MESSAGES.itemUnknown });
    }
  });

  it("the same id twice", () => {
    expect(refused(withTypes([{ id: "notes", label: "Notes" }, { id: "notes", label: "Notes 2" }])).errors).toEqual({ "type:1": FORM_MESSAGES.itemUnknown });
    expect(refused(withFields([semester(), semester({ label: "Sem again" })])).errors).toEqual({ "field:1:label": FORM_MESSAGES.itemUnknown });
    expect(refused(withFields([semester({ options: [{ id: "s1", label: "One" }, { id: "s1", label: "Uno" }] })])).errors).toEqual({
      "field:0:option:1": FORM_MESSAGES.itemUnknown,
    });
  });

  it("500 items", () => {
    const manyTypes = refused(withTypes(Array.from({ length: 500 }, (_, i) => ({ id: "", label: `Type ${i}` }))));
    expect(manyTypes.errors).toEqual({ types: FORM_MESSAGES.tooManyTypes(5) });
    const manyFields = refused(withFields(Array.from({ length: 500 }, (_, i) => ({ id: "", label: `F${i}`, kind: "text" as const, required: false }))));
    expect(manyFields.errors).toEqual({ fields: FORM_MESSAGES.tooManyDetails(3) });
    const manyChoices = refused(withFields([semester({ options: Array.from({ length: 500 }, (_, i) => ({ id: "", label: `C${i}` })) })]));
    expect(manyChoices.errors).toEqual({ "field:0:options": FORM_MESSAGES.tooManyChoices(15) });
  });

  it("several problems come back together, and nothing is returned as saved", () => {
    const draft: DraftFormConfig = {
      version: 3,
      types: [{ id: "", label: "A" }, { id: "", label: "a" }, { id: "ghost", label: "G" }],
      fields: [
        { id: "subject", label: "", kind: "dropdown", required: false, options: [] },
        { id: "", label: "Topic", kind: "dropdown", required: false, options: [{ id: "", label: "Only" }] },
      ],
    };
    const result = refused(draft);
    expect(result.errors).toEqual({
      "type:1": FORM_MESSAGES.labelTaken,
      "type:2": FORM_MESSAGES.itemUnknown,
      "field:0:label": FORM_MESSAGES.labelRequired,
      "field:1:options": FORM_MESSAGES.tooFewChoices(2),
    });
    expect(result).not.toHaveProperty("config");
  });

  it("never throws, whatever shape it is given", () => {
    const junk: unknown[] = [null, undefined, 5, "x", [], {}, { version: 3 }, { version: 3, types: {}, fields: [] }, { version: 3, types: [], fields: "x" }, { version: 3, types: [null, 5, "x", []], fields: [null, 5, "x", []] }];
    for (const draft of junk) {
      const result = prepareConfigForSave(CURRENT, draft as DraftFormConfig, counter());
      expect(result.ok, JSON.stringify(draft)).toBe(false);
    }
    // A broken current config is the caller's problem, but the draft side never throws.
    expect(() => prepareConfigForSave(CURRENT, { version: 3, types: [{ id: "notes", label: "N", get x() { throw new Error("boom"); } }], fields: [] } as never)).not.toThrow();
  });

  it("an item's own odd properties (a __proto__ key) do not leak into the result", () => {
    const hostile = JSON.parse('{"id":"notes","label":"Notes","__proto__":{"archived":true,"polluted":1}}');
    const config = saved(withTypes([hostile]));
    expect(config.types[0]).toEqual({ id: "notes", label: "Notes" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("isFormConfig", () => {
  it("is true for a valid form and false for anything parseFormConfig would replace with the default", () => {
    expect(isFormConfig(CURRENT)).toBe(true);
    expect(isFormConfig(DEFAULT_FORM_CONFIG)).toBe(true);
    for (const junk of [null, undefined, 5, "x", [], {}, { version: 1, types: "x", fields: [] }, { version: 0, types: [], fields: [] }]) {
      expect(isFormConfig(junk), JSON.stringify(junk)).toBe(false);
    }
  });
});
