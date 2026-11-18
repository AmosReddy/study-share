import { z } from "zod";

/**
 * A group's upload form: which types a file can have and which extra details it asks for. Title
 * and Type are always there and always required, so they are not stored. A removed item is kept
 * with `archived: true` (old files still point at it): it is not offered for new uploads, but it
 * still shows, filters and searches. This module is pure (no server code) so forms can import it.
 */
export type FormType = { id: string; label: string; archived?: boolean };
export type FormOption = { id: string; label: string; archived?: boolean };
export type FormField = {
  id: string;
  label: string;
  kind: "text" | "dropdown";
  required: boolean;
  archived?: boolean;
  /** Only for a dropdown. */
  options?: FormOption[];
};
export type FormConfig = { version: number; types: FormType[]; fields: FormField[] };

/** What a file answers: its type, the "Other" text (empty unless the type is Other) and its details by detail id. */
export type Answers = { typeId: string; typeOther: string; details: Record<string, string> };

/** The type id for "Other". It is always offered, never stored in `types`, and no configuration may use it. */
export const OTHER_TYPE_ID = "other";

/**
 * Limits count ACTIVE items only; labels count characters people see (code points).
 * `maxFields` counts Title and Type too. `maxRemoved` is how many archived items a list keeps.
 */
export const FORM_LIMITS = {
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
} as const;

/** Every sentence validateAnswers returns, in one place so the owner can change the wording. */
export const FORM_MESSAGES = {
  chooseType: "Choose what kind of file this is.",
  typeNotAvailable: "That type isn't available. Choose another.",
  typeRemoved: "That type was removed. Choose another.",
  otherRequired: "Say what kind of file it is.",
  required: "Fill this in.",
  chooseOne: "Choose one.",
  choiceNotAvailable: "Choose one of the listed choices.",
  detailRemoved: "That detail was removed from this form.",
  detailUnknown: "That detail isn't part of this form.",
  oddCharacter: "Remove the unusual character and try again.",
  tooLong: (max: number) => `Use ${max} characters or fewer.`,
} as const;

function deepFreeze<T extends object>(value: T): T {
  for (const inner of Object.values(value)) {
    if (inner !== null && typeof inner === "object") deepFreeze(inner);
  }
  return Object.freeze(value);
}

/**
 * What every group had before forms were configurable, and what a group gets until its owner
 * changes it. The ids are the old type keys and `subject`, so old files and old links keep
 * working. Frozen: it is shared, so a stray change would reach every group.
 */
export const DEFAULT_FORM_CONFIG: FormConfig = deepFreeze({
  version: 1,
  types: [
    { id: "notes", label: "Notes" },
    { id: "pyq", label: "Previous year paper" },
    { id: "study_material", label: "Study material" },
    { id: "assignment", label: "Assignment" },
  ],
  fields: [{ id: "subject", label: "Subject", kind: "text" as const, required: false }],
});

/** Counts characters people see (code points), so an emoji is one, not two. */
const characterCount = (value: string) => [...value].length;

/** Control characters (a NUL, which Postgres cannot store, among them) cannot be typed in an answer. */
const hasNoControl = (text: string) => !/\p{Cc}/u.test(text);

/** Whitespace runs, tabs and line breaks become one space, then the ends are trimmed (as titles are). */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** Anything that is not text counts as empty, so hostile input cannot make a check throw. */
const asText = (value: unknown): string => (typeof value === "string" ? value : "");

// ---------------------------------------------------------------------------------------------
// Reading a configuration from the database

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((id) => id !== "__proto__");

const labelSchema = (max: number) =>
  z
    .string()
    .refine((label) => label.trim().length > 0 && characterCount(label) <= max);

const optionSchema = z.object({
  id: idSchema,
  label: labelSchema(FORM_LIMITS.maxChoiceLabel),
  archived: z.boolean().optional(),
});

const typeSchema = z.object({
  id: idSchema.refine((id) => id !== OTHER_TYPE_ID),
  label: labelSchema(FORM_LIMITS.maxTypeLabel),
  archived: z.boolean().optional(),
});

const fieldSchema = z.object({
  id: idSchema,
  label: labelSchema(FORM_LIMITS.maxDetailLabel),
  kind: z.enum(["text", "dropdown"]),
  required: z.boolean(),
  archived: z.boolean().optional(),
  options: z.array(optionSchema).max(FORM_LIMITS.maxChoices + FORM_LIMITS.maxRemoved).optional(),
});

const hasUniqueIds = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;

const formConfigSchema = z
  .object({
    version: z.number().int().min(1),
    types: z.array(typeSchema).max(FORM_LIMITS.maxTypes + FORM_LIMITS.maxRemoved),
    fields: z.array(fieldSchema).max(FORM_LIMITS.maxDetails + FORM_LIMITS.maxRemoved),
  })
  .refine((config) => hasUniqueIds(config.types), "Type ids must be unique.")
  .refine((config) => hasUniqueIds(config.fields), "Detail ids must be unique.")
  .refine((config) => config.fields.every((field) => hasUniqueIds(field.options ?? [])), "Choice ids must be unique.");

/**
 * Reads a configuration stored as JSON. Anything that is not a valid configuration (a missing
 * value, the wrong shape, a duplicate id) gives DEFAULT_FORM_CONFIG, so a damaged value never
 * breaks a page. Never throws. Labels are not checked for duplicates or counts against the
 * active-item limits: the editor does that when the owner saves.
 */
export function parseFormConfig(raw: unknown): FormConfig {
  try {
    const parsed = formConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_FORM_CONFIG;
  } catch {
    return DEFAULT_FORM_CONFIG;
  }
}

// ---------------------------------------------------------------------------------------------
// Active items

export function activeTypes(config: FormConfig): FormType[] {
  return config.types.filter((type) => !type.archived);
}

export function activeFields(config: FormConfig): FormField[] {
  return config.fields.filter((field) => !field.archived);
}

export function activeOptions(field: FormField): FormOption[] {
  return (field.options ?? []).filter((option) => !option.archived);
}

// ---------------------------------------------------------------------------------------------
// Checking answers

type AnswerInput = { typeId: string; typeOther: string; details: Record<string, string> };

export type ValidatedAnswers =
  | { ok: true; value: Answers }
  | { ok: false; errors: Record<string, string> };

/**
 * Checks what a member answered against the group's form. Error keys are `type`, `typeOther` and
 * `detail:<fieldId>`; all problems come back together. Text is tidied (trimmed, whitespace runs as
 * one space). With no `existing` (a new upload) every rule applies. With `existing` (an edit), a
 * value that is unchanged always passes, whatever the form says now: a removed type or choice, an
 * old Other file with no text, a detail that became required. A removed detail's stored value is
 * carried over, so saving an edit never wipes it.
 */
export function validateAnswers(config: FormConfig, input: AnswerInput, existing?: Answers): ValidatedAnswers {
  const errors: Record<string, string> = {};

  // The type.
  const typeId = asText(input.typeId).trim();
  let typeOther = "";
  if (typeId === "") {
    errors.type = FORM_MESSAGES.chooseType;
  } else if (typeId === OTHER_TYPE_ID) {
    const text = tidy(asText(input.typeOther));
    const unchanged = existing?.typeId === OTHER_TYPE_ID && (text === existing.typeOther || asText(input.typeOther) === existing.typeOther);
    if (unchanged) {
      typeOther = existing.typeOther;
    } else if (text === "") {
      errors.typeOther = FORM_MESSAGES.otherRequired;
    } else if (!hasNoControl(text)) {
      errors.typeOther = FORM_MESSAGES.oddCharacter;
    } else if (characterCount(text) > FORM_LIMITS.maxOtherText) {
      errors.typeOther = FORM_MESSAGES.tooLong(FORM_LIMITS.maxOtherText);
    } else {
      typeOther = text;
    }
  } else if (existing?.typeId !== typeId) {
    const type = config.types.find((candidate) => candidate.id === typeId);
    if (!type) errors.type = FORM_MESSAGES.typeNotAvailable;
    else if (type.archived) errors.type = FORM_MESSAGES.typeRemoved;
  }

  // The details. `entries` keeps own properties only, so a key like "__proto__" is plain data.
  const given = (id: string): string | undefined =>
    Object.hasOwn(input.details ?? {}, id) ? asText(input.details[id]) : undefined;
  const stored = (id: string): string | undefined =>
    existing && Object.hasOwn(existing.details, id) ? existing.details[id] : undefined;

  const entries: [string, string][] = [];
  const knownIds = new Set(config.fields.map((field) => field.id));

  for (const field of config.fields) {
    const key = `detail:${field.id}`;
    const before = stored(field.id) ?? "";
    const raw = given(field.id) ?? "";
    const value = tidy(raw);

    if (field.archived) {
      // Not on the form any more: keep what the file has, take nothing new.
      if (value !== "" && value !== before && raw !== before) errors[key] = FORM_MESSAGES.detailRemoved;
      else if (before !== "") entries.push([field.id, before]);
      continue;
    }
    if (existing && (value === before || raw === before)) {
      if (before !== "") entries.push([field.id, before]);
      continue;
    }
    if (value === "") {
      if (field.required) errors[key] = field.kind === "dropdown" ? FORM_MESSAGES.chooseOne : FORM_MESSAGES.required;
      continue;
    }
    if (field.kind === "dropdown") {
      if (activeOptions(field).some((option) => option.id === value)) entries.push([field.id, value]);
      else errors[key] = FORM_MESSAGES.choiceNotAvailable;
    } else if (!hasNoControl(value)) {
      errors[key] = FORM_MESSAGES.oddCharacter;
    } else if (characterCount(value) > FORM_LIMITS.maxAnswer) {
      errors[key] = FORM_MESSAGES.tooLong(FORM_LIMITS.maxAnswer);
    } else {
      entries.push([field.id, value]);
    }
  }

  // Detail ids the form does not know: an error, unless the file already has exactly that value.
  for (const id of Object.keys(input.details ?? {})) {
    if (knownIds.has(id)) continue;
    const before = stored(id);
    const raw = given(id) ?? "";
    if (before === undefined || (raw !== before && tidy(raw) !== before)) errors[`detail:${id}`] = FORM_MESSAGES.detailUnknown;
  }
  // ...and whatever the file has for ids the form does not know is kept, never wiped.
  if (existing) {
    for (const [id, before] of Object.entries(existing.details)) {
      if (!knownIds.has(id) && before !== "") entries.push([id, before]);
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { typeId, typeOther, details: Object.fromEntries(entries) } };
}

// ---------------------------------------------------------------------------------------------
// Showing and searching

/** "Other: Lab manual", "Other" without text; removed and unknown ids still resolve (unknown is "Other"). */
export function typeLabel(config: FormConfig, typeId: string, typeOther: string): string {
  if (typeId === OTHER_TYPE_ID) {
    const text = typeOther.trim();
    return text === "" ? "Other" : `Other: ${text}`;
  }
  return config.types.find((type) => type.id === typeId)?.label ?? "Other";
}

/**
 * What to show for a detail's stored value: the text as typed, or a dropdown's choice label
 * (removed choices still resolve). A choice id nobody knows shows as "Unknown choice", not the id.
 */
export function detailDisplay(config: FormConfig, field: FormField, value: string): string {
  if (value === "") return "";
  // Use the configuration's copy of the detail, in case the one passed in is out of date.
  const current = config.fields.find((candidate) => candidate.id === field.id) ?? field;
  if (current.kind !== "dropdown") return value;
  return (current.options ?? []).find((option) => option.id === value)?.label ?? "Unknown choice";
}

/**
 * The types and dropdown choices whose label contains the search word (capitals ignored, plain
 * text, removed ones included), so a search for "semester 2" finds files by their choice even
 * after it was renamed. "Other" counts as a type label.
 */
export function searchIdsFor(config: FormConfig, term: string): { typeIds: string[]; optionIds: string[] } {
  const needle = term.trim().toLowerCase();
  if (needle === "") return { typeIds: [], optionIds: [] };
  const matches = (label: string) => label.toLowerCase().includes(needle);

  const typeIds = config.types.filter((type) => matches(type.label)).map((type) => type.id);
  if (matches("Other")) typeIds.push(OTHER_TYPE_ID);

  const optionIds = new Set<string>();
  for (const field of config.fields) {
    if (field.kind !== "dropdown") continue;
    for (const option of field.options ?? []) {
      if (matches(option.label)) optionIds.add(option.id);
    }
  }
  return { typeIds, optionIds: [...optionIds] };
}
