import { describe, expect, it } from "vitest";
import { DEFAULT_FORM_CONFIG, validateAnswers, type FormConfig } from "@/shared/form-config";
import { typeChoices, UNKNOWN_TYPE_LABEL } from "./form-inputs";

const CONFIG: FormConfig = {
  version: 2,
  types: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta", archived: true },
  ],
  fields: [],
};

describe("typeChoices", () => {
  it("offers the active types, then Other", () => {
    expect(typeChoices(CONFIG)).toEqual([
      { id: "a", label: "Alpha" },
      { id: "other", label: "Other" },
    ]);
  });

  it("adds a removed type the file holds, marked", () => {
    expect(typeChoices(CONFIG, "b")).toEqual([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta (removed)" },
      { id: "other", label: "Other" },
    ]);
  });

  it("adds 'Unknown type' for a type id the form has no record of, so the select can keep it", () => {
    const choices = typeChoices(CONFIG, "gone");
    expect(choices).toContainEqual({ id: "gone", label: UNKNOWN_TYPE_LABEL });
    expect(choices.at(-1)).toEqual({ id: "other", label: "Other" });
    // Nothing is added for a new upload, for Other, or for an active type.
    for (const id of [undefined, "", "other", "a"]) {
      expect(typeChoices(CONFIG, id).map((choice) => choice.label)).not.toContain(UNKNOWN_TYPE_LABEL);
    }
  });

  it("lets an edit keep the unknown type unchanged, but refuses it as a new choice", () => {
    const answers = { typeId: "gone", typeOther: "", details: {} };
    expect(validateAnswers(DEFAULT_FORM_CONFIG, answers, { typeId: "gone", typeOther: "", details: {} }).ok).toBe(true);
    expect(validateAnswers(DEFAULT_FORM_CONFIG, answers).ok).toBe(false);
  });
});
