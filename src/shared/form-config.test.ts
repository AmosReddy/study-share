import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_CONFIG,
  FORM_LIMITS,
  OTHER_TYPE_ID,
  activeFields,
  activeOptions,
  activeTypes,
  detailDisplay,
  parseFormConfig,
  searchIdsFor,
  typeLabel,
  validateAnswers,
  type Answers,
  type FormConfig,
} from "./form-config";

/** A class group's form: two details (one required dropdown, one optional text), a removed type and a removed choice. */
const CLASS_CONFIG: FormConfig = {
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

const answers = (over: Partial<Answers> = {}): Answers => ({
  typeId: "notes",
  typeOther: "",
  details: { semester: "s1" },
  ...over,
});

const ok = (result: ReturnType<typeof validateAnswers>) => {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result.value;
};
const errors = (result: ReturnType<typeof validateAnswers>) => {
  if (result.ok) throw new Error("expected errors");
  return result.errors;
};

describe("the default configuration", () => {
  it("has the four migrated types and one optional Subject detail", () => {
    expect(DEFAULT_FORM_CONFIG.version).toBe(1);
    expect(DEFAULT_FORM_CONFIG.types).toEqual([
      { id: "notes", label: "Notes" },
      { id: "pyq", label: "Previous year paper" },
      { id: "study_material", label: "Study material" },
      { id: "assignment", label: "Assignment" },
    ]);
    expect(DEFAULT_FORM_CONFIG.fields).toEqual([{ id: "subject", label: "Subject", kind: "text", required: false }]);
  });

  it("is itself a valid configuration that fits every limit", () => {
    expect(parseFormConfig(JSON.parse(JSON.stringify(DEFAULT_FORM_CONFIG)))).toEqual(DEFAULT_FORM_CONFIG);
    expect(DEFAULT_FORM_CONFIG.types.length).toBeLessThanOrEqual(FORM_LIMITS.maxTypes);
    expect(DEFAULT_FORM_CONFIG.types.some((t) => t.id === OTHER_TYPE_ID)).toBe(false);
  });

  it("cannot be changed by accident", () => {
    expect(() => (DEFAULT_FORM_CONFIG.types as { id: string; label: string }[]).push({ id: "x", label: "X" })).toThrow();
  });
});

describe("FORM_LIMITS", () => {
  it("holds the values the design decided", () => {
    expect(FORM_LIMITS).toMatchObject({
      maxTypes: 5,
      maxDetails: 3,
      maxFields: 5,
      maxChoices: 15,
      minChoices: 2,
      maxRemoved: 30,
      maxTypeLabel: 40,
      maxChoiceLabel: 40,
      maxDetailLabel: 30,
      maxAnswer: 100,
      maxOtherText: 40,
    });
  });
});

describe("parseFormConfig", () => {
  it("returns a valid configuration unchanged", () => {
    expect(parseFormConfig(CLASS_CONFIG)).toEqual(CLASS_CONFIG);
  });

  it("drops keys it does not know", () => {
    const parsed = parseFormConfig({ ...CLASS_CONFIG, extra: 1, types: [{ id: "a", label: "A", sneaky: true }] });
    expect(parsed.types).toEqual([{ id: "a", label: "A" }]);
    expect(parsed).not.toHaveProperty("extra");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "{}"],
    ["an empty object", {}],
    ["an array", []],
    ["a missing version", { types: [], fields: [] }],
    ["a non-integer version", { ...CLASS_CONFIG, version: 1.5 }],
    ["a zero version", { ...CLASS_CONFIG, version: 0 }],
    ["a duplicate type id", { ...CLASS_CONFIG, types: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }],
    ["a duplicate detail id", { ...CLASS_CONFIG, fields: [CLASS_CONFIG.fields[1], CLASS_CONFIG.fields[1]] }],
    [
      "a duplicate choice id in one dropdown",
      {
        ...CLASS_CONFIG,
        fields: [{ id: "d", label: "D", kind: "dropdown", required: false, options: [{ id: "x", label: "X" }, { id: "x", label: "Y" }] }],
      },
    ],
    ["the reserved type id", { ...CLASS_CONFIG, types: [{ id: "other", label: "Misc" }] }],
    ["an empty label", { ...CLASS_CONFIG, types: [{ id: "a", label: "   " }] }],
    ["an empty id", { ...CLASS_CONFIG, types: [{ id: "", label: "A" }] }],
    ["an unknown field kind", { ...CLASS_CONFIG, fields: [{ id: "n", label: "N", kind: "number", required: false }] }],
    ["a required flag that is not a boolean", { ...CLASS_CONFIG, fields: [{ id: "n", label: "N", kind: "text", required: "yes" }] }],
    ["a type label that is too long", { ...CLASS_CONFIG, types: [{ id: "a", label: "x".repeat(FORM_LIMITS.maxTypeLabel + 1) }] }],
  ])("gives the default for %s", (_name, raw) => {
    expect(parseFormConfig(raw)).toBe(DEFAULT_FORM_CONFIG);
  });

  it("allows the same choice id in two different dropdowns", () => {
    const option = { id: "x", label: "X" };
    const raw = {
      version: 1,
      types: [],
      fields: [
        { id: "a", label: "A", kind: "dropdown", required: false, options: [option] },
        { id: "b", label: "B", kind: "dropdown", required: false, options: [option] },
      ],
    };
    expect(parseFormConfig(raw).fields).toHaveLength(2);
  });

  it("never throws, whatever it is given", () => {
    const hostile = { get types(): never { throw new Error("boom"); } };
    expect(() => parseFormConfig(hostile)).not.toThrow();
    expect(parseFormConfig(hostile)).toBe(DEFAULT_FORM_CONFIG);
  });
});

describe("active helpers", () => {
  it("leave out archived items", () => {
    expect(activeTypes(CLASS_CONFIG).map((t) => t.id)).toEqual(["notes", "lab"]);
    expect(activeFields(CLASS_CONFIG).map((f) => f.id)).toEqual(["semester", "subject"]);
    expect(activeOptions(CLASS_CONFIG.fields[0]).map((o) => o.id)).toEqual(["s1", "s2"]);
  });

  it("give no choices for a text detail", () => {
    expect(activeOptions(CLASS_CONFIG.fields[1])).toEqual([]);
  });
});

describe("validateAnswers: the type", () => {
  it("requires a type", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, { typeId: "", typeOther: "", details: { semester: "s1" } }))).toHaveProperty("type");
  });

  it("rejects an unknown type id", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: "nope" })))).toHaveProperty("type");
  });

  it("rejects an archived type for a new upload", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: "old_quiz" })))).toHaveProperty("type");
  });

  it("accepts an archived type that is the file's existing type", () => {
    const existing = answers({ typeId: "old_quiz" });
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ typeId: "old_quiz" }), existing)).typeId).toBe("old_quiz");
  });

  it("rejects an archived type when the file had another type", () => {
    const existing = answers({ typeId: "notes" });
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: "old_quiz" }), existing))).toHaveProperty("type");
  });

  it("keeps an unchanged type even if the configuration no longer knows it", () => {
    const existing = answers({ typeId: "gone" });
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ typeId: "gone" }), existing)).typeId).toBe("gone");
  });

  it("accepts an active type and drops stray Other text", () => {
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ typeId: "lab", typeOther: "ignored" })));
    expect(value).toEqual({ typeId: "lab", typeOther: "", details: { semester: "s1" } });
  });
});

describe("validateAnswers: Other", () => {
  it("needs its text for a new upload", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID })))).toHaveProperty("typeOther");
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: "   " })))).toHaveProperty("typeOther");
  });

  it("accepts 1 to 40 characters, trimmed", () => {
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: "  Lab manual  " }))).typeOther).toBe("Lab manual");
    const longest = "x".repeat(FORM_LIMITS.maxOtherText);
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: longest }))).typeOther).toBe(longest);
  });

  it("rejects 41 characters", () => {
    const tooLong = "x".repeat(FORM_LIMITS.maxOtherText + 1);
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: tooLong })))).toHaveProperty("typeOther");
  });

  it("counts characters people see, not UTF-16 units", () => {
    const emoji = "📚".repeat(FORM_LIMITS.maxOtherText);
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: emoji }))).typeOther).toBe(emoji);
  });

  it("lets an old Other file with no text stay as it is", () => {
    const existing = answers({ typeId: OTHER_TYPE_ID, typeOther: "" });
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: "" }), existing));
    expect(value.typeId).toBe(OTHER_TYPE_ID);
    expect(value.typeOther).toBe("");
  });

  it("still checks new text typed on an old Other file", () => {
    const existing = answers({ typeId: OTHER_TYPE_ID, typeOther: "" });
    const tooLong = "x".repeat(FORM_LIMITS.maxOtherText + 1);
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: tooLong }), existing))).toHaveProperty("typeOther");
  });

  it("needs text when a file changes to Other from another type", () => {
    const existing = answers({ typeId: "notes" });
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID }), existing))).toHaveProperty("typeOther");
  });

  it("rejects control characters", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ typeId: OTHER_TYPE_ID, typeOther: "a\u0000b" })))).toHaveProperty("typeOther");
  });
});

describe("validateAnswers: details", () => {
  it("fails a required detail that is missing or blank", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: {} })))).toHaveProperty(["detail:semester"]);
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "  " } })))).toHaveProperty(["detail:semester"]);
  });

  it("passes an optional detail left empty, and leaves it out of the result", () => {
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", subject: "   " } })));
    expect(value.details).toEqual({ semester: "s1" });
  });

  it("trims a text answer", () => {
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", subject: "  Maths  " } })));
    expect(value.details.subject).toBe("Maths");
  });

  it("rejects a text answer over 100 characters and accepts exactly 100", () => {
    const longest = "x".repeat(FORM_LIMITS.maxAnswer);
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", subject: longest } }))).details.subject).toBe(longest);
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", subject: `${longest}x` } })))).toHaveProperty(["detail:subject"]);
  });

  it("rejects a control character in a text answer", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", subject: "a\u0000b" } })))).toHaveProperty(["detail:subject"]);
  });

  it("needs a dropdown value to be an active choice id", () => {
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s2" } }))).details.semester).toBe("s2");
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "nope" } })))).toHaveProperty(["detail:semester"]);
    // The label is not an id.
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "Semester 1" } })))).toHaveProperty(["detail:semester"]);
  });

  it("rejects an archived choice for a new answer", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s0" } })))).toHaveProperty(["detail:semester"]);
  });

  it("accepts an archived choice equal to the existing value", () => {
    const existing = answers({ details: { semester: "s0" } });
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s0" } }), existing)).details.semester).toBe("s0");
  });

  it("rejects an archived choice when the file had another value", () => {
    const existing = answers({ details: { semester: "s1" } });
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s0" } }), existing))).toHaveProperty(["detail:semester"]);
  });

  it("rejects an unknown detail id", () => {
    const result = validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", bogus: "x" } }));
    expect(errors(result)).toHaveProperty(["detail:bogus"]);
  });

  it("rejects an unknown detail id even when it is empty, and names like __proto__", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", bogus: "" } })))).toHaveProperty(["detail:bogus"]);
    const hostile = JSON.parse('{"semester":"s1","__proto__":"x"}') as Record<string, string>;
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: hostile })))).toHaveProperty(["detail:__proto__"]);
  });

  it("does not take a value for a removed detail", () => {
    expect(errors(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", year: "2024" } })))).toHaveProperty(["detail:year"]);
  });

  it("keeps a removed detail's stored value, even when the form does not send it", () => {
    const existing = answers({ details: { semester: "s1", year: "2024", ghost: "kept" } });
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s2" } }), existing));
    expect(value.details).toEqual({ semester: "s2", year: "2024", ghost: "kept" });
  });

  it("accepts an unchanged value for a removed detail", () => {
    const existing = answers({ details: { semester: "s1", year: "2024" } });
    expect(ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "s1", year: "2024" } }), existing)).details.year).toBe("2024");
  });

  it("lets a detail that is now required but empty stay empty on edit", () => {
    const existing = answers({ details: {} });
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ details: {} }), existing));
    expect(value.details).toEqual({});
  });

  it("lets an unchanged stored value pass even if it would not pass now", () => {
    const longStored = "x".repeat(FORM_LIMITS.maxAnswer + 20);
    const existing = answers({ details: { semester: "gone", subject: longStored } });
    const value = ok(validateAnswers(CLASS_CONFIG, answers({ details: { semester: "gone", subject: longStored } }), existing));
    expect(value.details).toEqual({ semester: "gone", subject: longStored });
  });

  it("reports every problem at once", () => {
    const result = errors(validateAnswers(CLASS_CONFIG, { typeId: "", typeOther: "", details: { bogus: "x" } }));
    expect(Object.keys(result).sort()).toEqual(["detail:bogus", "detail:semester", "type"]);
  });

  it("gives friendly, non-empty messages", () => {
    const result = errors(validateAnswers(CLASS_CONFIG, { typeId: "", typeOther: "", details: {} }));
    for (const message of Object.values(result)) expect(message.length).toBeGreaterThan(5);
  });

  it("does not change what it is given", () => {
    const input = { typeId: "notes", typeOther: "", details: { semester: " s1 " } };
    const copy = structuredClone(input);
    validateAnswers(CLASS_CONFIG, input);
    expect(input).toEqual(copy);
  });

  it("works with the default configuration", () => {
    const value = ok(validateAnswers(DEFAULT_FORM_CONFIG, { typeId: "pyq", typeOther: "", details: { subject: "Physics" } }));
    expect(value).toEqual({ typeId: "pyq", typeOther: "", details: { subject: "Physics" } });
  });
});

describe("typeLabel", () => {
  it("shows Other with its text", () => {
    expect(typeLabel(CLASS_CONFIG, OTHER_TYPE_ID, "Lab manual")).toBe("Other: Lab manual");
  });

  it("shows plain Other without text", () => {
    expect(typeLabel(CLASS_CONFIG, OTHER_TYPE_ID, "")).toBe("Other");
    expect(typeLabel(CLASS_CONFIG, OTHER_TYPE_ID, "   ")).toBe("Other");
  });

  it("shows the label of an active or an archived type", () => {
    expect(typeLabel(CLASS_CONFIG, "lab", "")).toBe("Lab report");
    expect(typeLabel(CLASS_CONFIG, "old_quiz", "")).toBe("Quiz");
  });

  it("shows Other for an id it does not know", () => {
    expect(typeLabel(CLASS_CONFIG, "nope", "")).toBe("Other");
    expect(typeLabel(CLASS_CONFIG, "toString", "")).toBe("Other");
  });

  it("ignores Other text on a real type", () => {
    expect(typeLabel(CLASS_CONFIG, "lab", "leftover")).toBe("Lab report");
  });
});

describe("detailDisplay", () => {
  const [semester, subject] = CLASS_CONFIG.fields;

  it("shows a text value as it is", () => {
    expect(detailDisplay(CLASS_CONFIG, subject, "Maths")).toBe("Maths");
  });

  it("shows the label of a dropdown choice, archived ones too", () => {
    expect(detailDisplay(CLASS_CONFIG, semester, "s2")).toBe("Semester 2");
    expect(detailDisplay(CLASS_CONFIG, semester, "s0")).toBe("Semester Zero");
  });

  it("does not show a raw id for a choice it does not know", () => {
    expect(detailDisplay(CLASS_CONFIG, semester, "zzz")).toBe("Unknown choice");
  });

  it("shows nothing for an empty value", () => {
    expect(detailDisplay(CLASS_CONFIG, semester, "")).toBe("");
  });
});

describe("searchIdsFor", () => {
  it("finds a type by part of its label, ignoring capitals", () => {
    expect(searchIdsFor(DEFAULT_FORM_CONFIG, "previous")).toEqual({ typeIds: ["pyq"], optionIds: [] });
    expect(searchIdsFor(DEFAULT_FORM_CONFIG, "NOTES")).toEqual({ typeIds: ["notes"], optionIds: [] });
  });

  it("finds an archived type and an archived choice", () => {
    expect(searchIdsFor(CLASS_CONFIG, "quiz").typeIds).toEqual(["old_quiz"]);
    expect(searchIdsFor(CLASS_CONFIG, "zero").optionIds).toEqual(["s0"]);
  });

  it("finds dropdown choices by label", () => {
    expect(searchIdsFor(CLASS_CONFIG, "semester 2")).toEqual({ typeIds: [], optionIds: ["s2"] });
    expect(searchIdsFor(CLASS_CONFIG, "semester").optionIds).toEqual(["s1", "s2", "s0"]);
  });

  it("matches Other for the reserved id", () => {
    expect(searchIdsFor(CLASS_CONFIG, "oth").typeIds).toEqual(["other"]);
  });

  it("does not match text details or detail labels", () => {
    expect(searchIdsFor(CLASS_CONFIG, "subject")).toEqual({ typeIds: [], optionIds: [] });
  });

  it("finds nothing for an empty or blank term, or no match", () => {
    expect(searchIdsFor(CLASS_CONFIG, "")).toEqual({ typeIds: [], optionIds: [] });
    expect(searchIdsFor(CLASS_CONFIG, "   ")).toEqual({ typeIds: [], optionIds: [] });
    expect(searchIdsFor(CLASS_CONFIG, "zebra")).toEqual({ typeIds: [], optionIds: [] });
  });

  it("treats the term as plain text", () => {
    expect(searchIdsFor(CLASS_CONFIG, ".*")).toEqual({ typeIds: [], optionIds: [] });
  });

  it("lists a choice id once when two dropdowns share it", () => {
    const shared = { id: "x", label: "Spring" };
    const config: FormConfig = {
      version: 1,
      types: [],
      fields: [
        { id: "a", label: "A", kind: "dropdown", required: false, options: [shared] },
        { id: "b", label: "B", kind: "dropdown", required: false, options: [shared] },
      ],
    };
    expect(searchIdsFor(config, "spring").optionIds).toEqual(["x"]);
  });
});
