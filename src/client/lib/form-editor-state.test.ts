import { describe, expect, it } from "vitest";
import { DEFAULT_FORM_CONFIG, FORM_MESSAGES, prepareConfigForSave, type FormConfig } from "@/shared/form-config";
import {
  choiceAddBlocked,
  clearErrors,
  defaultsDraft,
  draftFromConfig,
  editorReducer,
  errorsByKey,
  fieldAddBlocked,
  fieldsUsed,
  fieldsUsedText,
  isDirty,
  previewConfig,
  toDraftFormConfig,
  typeAddBlocked,
  type EditorAction,
  type EditorDraft,
} from "./form-editor-state";

const SAVED: FormConfig = {
  version: 3,
  types: [
    { id: "t1", label: "Lecture notes" },
    { id: "t2", label: "Lab record" },
    { id: "t3", label: "Old type", archived: true },
  ],
  fields: [
    {
      id: "f1",
      label: "Semester",
      kind: "dropdown",
      required: true,
      options: [
        { id: "o1", label: "Sem 1" },
        { id: "o2", label: "Sem 2" },
        { id: "o3", label: "Sem 0", archived: true },
      ],
    },
    { id: "f2", label: "Subject", kind: "text", required: false },
    { id: "f3", label: "Gone", kind: "text", required: false, archived: true },
  ],
};

function run(start: EditorDraft, ...actions: EditorAction[]): EditorDraft {
  return actions.reduce(editorReducer, start);
}

const start = () => draftFromConfig(SAVED);

describe("draftFromConfig and toDraftFormConfig", () => {
  it("holds the active items only, keeping their ids and the version", () => {
    const draft = start();
    expect(draft.version).toBe(3);
    expect(draft.types.map((type) => type.id)).toEqual(["t1", "t2"]);
    expect(draft.fields.map((field) => field.id)).toEqual(["f1", "f2"]);
    expect(draft.fields[0]!.options.map((choice) => choice.id)).toEqual(["o1", "o2"]);
  });

  it("sends no keys, and choices only for a dropdown", () => {
    expect(toDraftFormConfig(start())).toEqual({
      version: 3,
      types: [
        { id: "t1", label: "Lecture notes" },
        { id: "t2", label: "Lab record" },
      ],
      fields: [
        {
          id: "f1",
          label: "Semester",
          kind: "dropdown",
          required: true,
          options: [
            { id: "o1", label: "Sem 1" },
            { id: "o2", label: "Sem 2" },
          ],
        },
        { id: "f2", label: "Subject", kind: "text", required: false },
      ],
    });
  });

  it("makes a draft the server accepts, unchanged, and a new version", () => {
    const result = prepareConfigForSave(SAVED, toDraftFormConfig(start()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.version).toBe(4);
  });
});

describe("isDirty", () => {
  it("is false until something changes, and false again when it is changed back", () => {
    const saved = start();
    expect(isDirty(saved, saved)).toBe(false);
    const renamed = run(saved, { type: "renameType", key: "e:t1", label: "Lectures" });
    expect(isDirty(renamed, saved)).toBe(true);
    expect(isDirty(run(renamed, { type: "renameType", key: "e:t1", label: "Lecture notes" }), saved)).toBe(false);
    expect(isDirty(run(saved, { type: "moveType", key: "e:t1", direction: 1 }), saved)).toBe(true);
  });
});

describe("types", () => {
  it("adds a new type with an empty id and its own key, then renames and removes it", () => {
    const added = run(start(), { type: "addType" });
    const fresh = added.types[2]!;
    expect(fresh).toMatchObject({ id: "", label: "" });
    expect(fresh.key).not.toBe("e:t1");
    const named = run(added, { type: "renameType", key: fresh.key, label: "Exam" });
    expect(named.types[2]!.label).toBe("Exam");
    expect(run(named, { type: "removeType", key: fresh.key }).types).toHaveLength(2);
  });

  it("gives every new item a different key", () => {
    const draft = run(start(), { type: "addType" }, { type: "addType" });
    expect(new Set(draft.types.map((type) => type.key)).size).toBe(4);
  });

  it("moves up and down, and does nothing at the ends", () => {
    const down = run(start(), { type: "moveType", key: "e:t1", direction: 1 });
    expect(down.types.map((type) => type.id)).toEqual(["t2", "t1"]);
    expect(run(down, { type: "moveType", key: "e:t1", direction: 1 })).toBe(down);
    expect(run(start(), { type: "moveType", key: "e:t1", direction: -1 }).types.map((type) => type.id)).toEqual(["t1", "t2"]);
    const up = run(down, { type: "moveType", key: "e:t1", direction: -1 });
    expect(up.types.map((type) => type.id)).toEqual(["t1", "t2"]);
  });

  it("refuses a sixth type, with the reason", () => {
    let draft = start();
    for (let i = 0; i < 3; i++) draft = run(draft, { type: "addType" });
    expect(draft.types).toHaveLength(5);
    expect(typeAddBlocked(draft)).toBe(FORM_MESSAGES.tooManyTypes(5));
    expect(run(draft, { type: "addType" })).toBe(draft);
    expect(typeAddBlocked(start())).toBeNull();
  });

  it("ignores a key that is not there", () => {
    const draft = start();
    expect(run(draft, { type: "removeType", key: "nope" })).toBe(draft);
    expect(run(draft, { type: "moveType", key: "nope", direction: 1 })).toBe(draft);
  });
});

describe("details", () => {
  it("adds a new optional text detail and counts it", () => {
    const draft = start();
    expect(fieldsUsed(draft)).toBe(4);
    expect(fieldsUsedText(draft)).toBe("4 of 5 fields used");
    const added = run(draft, { type: "addField" });
    expect(added.fields[2]).toMatchObject({ id: "", label: "", kind: "text", required: false, options: [] });
    expect(fieldsUsedText(added)).toBe("5 of 5 fields used");
  });

  it("refuses a fourth detail, with the reason", () => {
    const full = run(start(), { type: "addField" });
    expect(fieldAddBlocked(full)).toBe(FORM_MESSAGES.tooManyDetails(3));
    expect(run(full, { type: "addField" })).toBe(full);
  });

  it("renames, toggles required, moves and removes", () => {
    let draft = run(start(), { type: "renameField", key: "e:f2", label: "Topic" }, { type: "setRequired", key: "e:f2", required: true });
    expect(draft.fields[1]).toMatchObject({ label: "Topic", required: true });
    draft = run(draft, { type: "moveField", key: "e:f2", direction: -1 });
    expect(draft.fields.map((field) => field.id)).toEqual(["f2", "f1"]);
    expect(run(draft, { type: "removeField", key: "e:f2" }).fields.map((field) => field.id)).toEqual(["f1"]);
  });

  it("switches the kind of a NEW detail only, giving a dropdown two empty choices", () => {
    const added = run(start(), { type: "addField" });
    const key = added.fields[2]!.key;
    const dropdown = run(added, { type: "setKind", key, kind: "dropdown" });
    expect(dropdown.fields[2]!.kind).toBe("dropdown");
    expect(dropdown.fields[2]!.options).toHaveLength(2);
    expect(dropdown.fields[2]!.options.every((choice) => choice.id === "" && choice.label === "")).toBe(true);
    expect(new Set(dropdown.fields[2]!.options.map((choice) => choice.key)).size).toBe(2);
    // Back to text keeps what was typed in case it is switched again, but sends no choices.
    const text = run(dropdown, { type: "setKind", key, kind: "text" });
    expect(toDraftFormConfig(text).fields[2]).not.toHaveProperty("options");
    expect(run(text, { type: "setKind", key, kind: "dropdown" }).fields[2]!.options).toHaveLength(2);
  });

  it("never changes the kind of a detail that already exists", () => {
    const draft = start();
    expect(run(draft, { type: "setKind", key: "e:f2", kind: "dropdown" })).toBe(draft);
    expect(run(draft, { type: "setKind", key: "e:f1", kind: "text" })).toBe(draft);
  });
});

describe("choices", () => {
  const withNewDropdown = () => {
    const added = run(start(), { type: "addField" });
    const key = added.fields[2]!.key;
    return { key, draft: run(added, { type: "setKind", key, kind: "dropdown" }) };
  };

  it("adds, renames, moves and removes a choice", () => {
    let draft = run(start(), { type: "addChoice", fieldKey: "e:f1" });
    const fresh = draft.fields[0]!.options[2]!;
    expect(fresh).toMatchObject({ id: "", label: "" });
    draft = run(draft, { type: "renameChoice", fieldKey: "e:f1", choiceKey: fresh.key, label: "Sem 3" });
    draft = run(draft, { type: "moveChoice", fieldKey: "e:f1", choiceKey: fresh.key, direction: -1 });
    expect(draft.fields[0]!.options.map((choice) => choice.label)).toEqual(["Sem 1", "Sem 3", "Sem 2"]);
    draft = run(draft, { type: "removeChoice", fieldKey: "e:f1", choiceKey: "e:o1" });
    expect(draft.fields[0]!.options.map((choice) => choice.label)).toEqual(["Sem 3", "Sem 2"]);
  });

  it("refuses a sixteenth choice, with the reason", () => {
    const { key, draft: made } = withNewDropdown();
    let draft = made;
    for (let i = 0; i < 13; i++) draft = run(draft, { type: "addChoice", fieldKey: key });
    const field = draft.fields[2]!;
    expect(field.options).toHaveLength(15);
    expect(choiceAddBlocked(field)).toBe(FORM_MESSAGES.tooManyChoices(15));
    expect(run(draft, { type: "addChoice", fieldKey: key })).toBe(draft);
  });

  it("does not add a choice to a text detail", () => {
    const draft = start();
    expect(run(draft, { type: "addChoice", fieldKey: "e:f2" })).toBe(draft);
  });

  it("lets a dropdown drop to one choice (the server then refuses to save it)", () => {
    const draft = run(start(), { type: "removeChoice", fieldKey: "e:f1", choiceKey: "e:o2" });
    expect(draft.fields[0]!.options).toHaveLength(1);
    const result = prepareConfigForSave(SAVED, toDraftFormConfig(draft));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["field:0:options"]).toBe(FORM_MESSAGES.tooFewChoices(2));
  });
});

describe("the preview", () => {
  it("is a form configuration with temporary ids for new items and a stand-in for empty names", () => {
    const draft = run(start(), { type: "addType" }, { type: "renameType", key: "e:t1", label: "Lectures" }, { type: "addField" });
    const preview = previewConfig(draft);
    expect(preview.types.map((type) => type.label)).toEqual(["Lectures", "Lab record", "(no name yet)"]);
    expect(preview.types[0]!.id).toBe("t1");
    expect(preview.types[2]!.id).toMatch(/^new-n/);
    expect(preview.fields[2]).toMatchObject({ label: "(no name yet)", kind: "text", required: false });
    expect(preview.fields[0]!.options?.map((option) => option.label)).toEqual(["Sem 1", "Sem 2"]);
    // Nothing archived is in it.
    expect(JSON.stringify(preview)).not.toContain("archived");
  });
});

describe("defaults", () => {
  it("fills in the default form and keeps the draft's version", () => {
    const draft = defaultsDraft(SAVED, start());
    expect(draft.version).toBe(3);
    expect(draft.types.map((type) => type.label)).toEqual(DEFAULT_FORM_CONFIG.types.map((type) => type.label));
    expect(draft.fields.map((field) => [field.label, field.kind, field.required])).toEqual([["Subject", "text", false]]);
  });

  it("keeps the id of a saved item with the same name (so its files keep it), and makes the rest new", () => {
    const saved: FormConfig = {
      version: 2,
      types: [
        { id: "x1", label: "notes" },
        { id: "x2", label: "Something else" },
      ],
      fields: [{ id: "x3", label: "SUBJECT", kind: "text", required: true }],
    };
    const draft = defaultsDraft(saved, draftFromConfig(saved));
    expect(draft.types.map((type) => type.id)).toEqual(["x1", "", "", ""]);
    expect(draft.types[0]!.label).toBe("Notes");
    expect(draft.fields[0]).toMatchObject({ id: "x3", label: "Subject", required: false });
    expect(new Set([...draft.types, ...draft.fields].map((item) => item.key)).size).toBe(5);
  });

  it("falls back to the original id when the item was renamed, and never uses an id twice", () => {
    const saved: FormConfig = {
      version: 1,
      types: [{ id: "notes", label: "Lecture notes" }],
      fields: [{ id: "subject", label: "Topic", kind: "text", required: false }],
    };
    const draft = defaultsDraft(saved, draftFromConfig(saved));
    expect(draft.types[0]).toMatchObject({ id: "notes", label: "Notes" });
    expect(draft.fields[0]).toMatchObject({ id: "subject", label: "Subject" });
    expect(new Set(draft.types.filter((type) => type.id).map((type) => type.id)).size).toBe(1);
  });

  it("does not reuse a saved dropdown as the text Subject", () => {
    const saved: FormConfig = {
      version: 1,
      types: [],
      fields: [
        {
          id: "subject",
          label: "Subject",
          kind: "dropdown",
          required: false,
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      ],
    };
    expect(defaultsDraft(saved, draftFromConfig(saved)).fields[0]!.id).toBe("");
  });

  it("is only a draft: the default draft is saveable and archives what it left out", () => {
    const result = prepareConfigForSave(SAVED, toDraftFormConfig(defaultsDraft(SAVED, start())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.types.filter((type) => !type.archived).map((type) => type.label)).toEqual(
      DEFAULT_FORM_CONFIG.types.map((type) => type.label),
    );
    // Subject kept its id, the old dropdown became archived.
    expect(result.config.fields.find((field) => field.id === "f2")?.archived).toBeUndefined();
    expect(result.config.fields.find((field) => field.id === "f1")?.archived).toBe(true);
  });
});

describe("errorsByKey", () => {
  it("puts each server error on the item it was about, by key, so reordering cannot move it", () => {
    const draft = run(start(), { type: "addType" }, { type: "addField" });
    const errors = errorsByKey(draft, {
      types: "too many",
      "type:1": "name taken",
      "type:2": "give a name",
      fields: "too many details",
      "field:0:options": "add choices",
      "field:0:option:1": "bad choice",
      "field:2:label": "no name",
    });
    const reordered = run(draft, { type: "moveType", key: "e:t2", direction: -1 });
    expect(errors).toEqual({
      types: "too many",
      "type:e:t2": "name taken",
      [`type:${draft.types[2]!.key}`]: "give a name",
      fields: "too many details",
      "field:e:f1:options": "add choices",
      "field:e:f1:option:e:o2": "bad choice",
      [`field:${draft.fields[2]!.key}:label`]: "no name",
    });
    expect(reordered.types[0]!.key).toBe("e:t2");
  });

  it("keeps the first error of a key and sends what fits nothing to `form`", () => {
    const draft = start();
    expect(errorsByKey(draft, { "type:9": "x", "field:9:label": "y", "field:0:option:9": "z", weird: "w" })).toEqual({ form: "x" });
    expect(errorsByKey(draft, { "type:__proto__": "x" })).toEqual({ form: "x" });
  });

  it("matches the keys the server really produces", () => {
    const hostile = run(start(), { type: "renameType", key: "e:t1", label: "lab record" }, { type: "renameField", key: "e:f1", label: "" });
    const result = prepareConfigForSave(SAVED, toDraftFormConfig(hostile));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const keyed = errorsByKey(hostile, result.errors);
    expect(keyed).not.toHaveProperty("form");
    expect(keyed["type:e:t1"]).toBeUndefined();
    expect(keyed["type:e:t2"]).toBe(FORM_MESSAGES.labelTaken);
    expect(keyed["field:e:f1:label"]).toBe(FORM_MESSAGES.labelRequired);
  });
});

describe("clearErrors", () => {
  it("drops the given keys, and returns the same object when none is there", () => {
    const errors = { a: "1", b: "2" };
    expect(clearErrors(errors, "a")).toEqual({ b: "2" });
    expect(clearErrors(errors, "zzz")).toBe(errors);
  });
});
