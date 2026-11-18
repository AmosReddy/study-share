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
  // Saving the form (the owner's editor). Keys of the errors are described at prepareConfigForSave.
  formChangedElsewhere:
    "This form was changed somewhere else (maybe in another tab). Nothing was saved. Reload the page to see the latest form, then make your changes again.",
  badDraft: "Something is wrong with this form. Reload the page and try again.",
  formTooBig: "This form has too many items to save. Remove some and try again.",
  couldNotSave: "We couldn't save the form right now. Please try again.",
  /** The same answer for a stranger, a plain member, a removed member and a group that is not there. */
  notAvailable: "That form isn't available.",
  labelRequired: "Give this a name.",
  labelTaken: "You already have one with this name.",
  otherReserved: "\"Other\" is added for you. Choose a different name.",
  itemUnknown: "This item is out of date. Reload the page and try again.",
  kindLocked: "The kind of a detail can't be changed. Remove it and add a new one instead.",
  textHasChoices: "Only a dropdown has choices.",
  tooManyTypes: (max: number) => `You can have up to ${max} types. Remove one to add another.`,
  tooManyDetails: (max: number) => `You can have up to ${max} extra details. Remove one to add another.`,
  tooManyChoices: (max: number) => `A dropdown can have up to ${max} choices. Remove one to add another.`,
  tooFewChoices: (min: number) => `Add at least ${min} choices.`,
  tooManyRemoved: (max: number) =>
    `This list already keeps ${max} removed items and can't keep more. Please tidy up: keep some items instead of removing more.`,
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

/** True when the value is a valid configuration, the test parseFormConfig applies before it falls back to the default. */
export function isFormConfig(raw: unknown): boolean {
  try {
    return formConfigSchema.safeParse(raw).success;
  } catch {
    return false;
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
  // One letter would match nearly every type and choice label, so labels are only matched from two
  // characters. The title, file name and text details are still searched by the store for any length.
  if (needle.length < 2) return { typeIds: [], optionIds: [] };
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

// ---------------------------------------------------------------------------------------------
// Saving a form (the owner's editor)

/**
 * What the editor sends: the ACTIVE items only, in the order the owner arranged them. An item that
 * already exists carries its id; a new one has the id `""` (the server makes the id). A removed
 * item is simply missing: prepareConfigForSave archives it.
 */
export type DraftFormConfig = {
  version: number;
  types: { id: string; label: string }[];
  fields: {
    id: string;
    label: string;
    kind: "text" | "dropdown";
    required: boolean;
    options?: { id: string; label: string }[];
  }[];
};

export type SaveFormResult =
  | { ok: true; config: FormConfig }
  | { ok: false; errors: Record<string, string>; formError?: string };

/** A short random id for a new type, detail or choice. */
const randomItemId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** How many times a new id is asked for before giving up (a collision of 8 random hex digits is very rare). */
const ID_ATTEMPTS = 20;

class NoIdError extends Error {}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A label as it will be stored (tidied), or the sentence saying what is wrong with it. */
function checkLabel(raw: unknown, max: number): { label: string } | { error: string } {
  const label = tidy(asText(raw));
  if (label === "") return { error: FORM_MESSAGES.labelRequired };
  // A control character or half of an emoji (which Postgres refuses in JSON) cannot be stored.
  if (!hasNoControl(label) || !label.isWellFormed()) return { error: FORM_MESSAGES.oddCharacter };
  if (characterCount(label) > max) return { error: FORM_MESSAGES.tooLong(max) };
  return { label };
}

type Resolved<C> = { index: number; existing: C | null; label: string; raw: Record<string, unknown> };

/**
 * Matches one list of the draft with the same list of the current form. Each draft item is either
 * new (id `""`) or names an ACTIVE current item by id, once; its label is checked (tidied, not
 * empty, within `maxLabel`, not a duplicate of an earlier one ignoring capitals and spaces).
 * Problems go to `errors` under `keyOf(index)` (the first one for a key wins). `resolved` holds the
 * items that have a usable id and label, in draft order.
 */
function resolveItems<C extends { id: string; archived?: boolean }>(
  drafts: readonly unknown[],
  current: readonly C[],
  maxLabel: number,
  keyOf: (index: number) => string,
  errors: Record<string, string>,
  isReserved?: (label: string) => boolean,
): { resolved: Resolved<C>[]; ok: boolean } {
  const activeById = new Map<string, C>();
  for (const item of current) if (!item.archived) activeById.set(item.id, item);
  const usedIds = new Set<string>();
  const seenLabels = new Set<string>();
  const resolved: Resolved<C>[] = [];
  let ok = true;
  const fail = (key: string, message: string) => {
    errors[key] ??= message;
    ok = false;
  };

  drafts.forEach((entry, index) => {
    const key = keyOf(index);
    if (!isPlainObject(entry)) return fail(key, FORM_MESSAGES.itemUnknown);

    let existing: C | null = null;
    if (entry.id !== "") {
      const id = entry.id;
      const found = typeof id === "string" ? activeById.get(id) : undefined;
      if (typeof id !== "string" || !found || usedIds.has(id)) return fail(key, FORM_MESSAGES.itemUnknown);
      usedIds.add(id);
      existing = found;
    }

    const checked = checkLabel(entry.label, maxLabel);
    if ("error" in checked) return fail(key, checked.error);
    if (isReserved?.(checked.label)) fail(key, FORM_MESSAGES.otherReserved);
    const same = checked.label.toLowerCase();
    if (seenLabels.has(same)) fail(key, FORM_MESSAGES.labelTaken);
    seenLabels.add(same);
    resolved.push({ index, existing, label: checked.label, raw: entry });
  });
  return { resolved, ok };
}

/** The current items that will be archived: the ones already, and the active ones the draft dropped. */
function removedOf<C extends { id: string; archived?: boolean }>(current: readonly C[], kept: ReadonlySet<string>): C[] {
  return current.filter((item) => item.archived || !kept.has(item.id));
}

const keptIds = <C extends { id: string }>(resolved: Resolved<C>[]) =>
  new Set(resolved.flatMap((item) => (item.existing ? [item.existing.id] : [])));

/**
 * Turns the owner's draft into the next configuration, or says what is wrong. Pure: no clock, no
 * storage, never throws.
 *
 * - A draft whose `version` is not the current one is stale: `{ ok: false, errors: {}, formError:
 *   FORM_MESSAGES.formChangedElsewhere }`. (The store checks the version again when it writes.)
 * - Limits count active items (see FORM_LIMITS). A dropdown needs at least 2 active choices. Labels
 *   are tidied (whitespace runs become one space), cannot be empty, and are unique within their list
 *   ignoring capitals; a type cannot be called "Other" (that row is added for you).
 * - Error keys: `types`, `type:<index>`, `fields`, `field:<index>:label` (also a bad id, a changed
 *   kind), `field:<index>:options`, `field:<index>:option:<j>`. All problems come back together.
 * - An id must be `""` (new) or an ACTIVE item of the current form: an unknown id, `other`,
 *   `__proto__`, a repeated id or a removed item's id is refused (a removed item is never restored:
 *   re-adding its label makes a new item). A detail's kind cannot change.
 * - Items the draft leaves out become `archived: true` and are kept after the active ones (old files
 *   still point at them). At most FORM_LIMITS.maxRemoved are kept per list; more is an error.
 * - New items get ids from `newId` (an id that list already has, an empty or reserved one is asked
 *   for again). Output `version` is the current one plus 1.
 */
export function prepareConfigForSave(
  current: FormConfig,
  draft: DraftFormConfig,
  newId: () => string = randomItemId,
): SaveFormResult {
  const bad = (formError: string): SaveFormResult => ({ ok: false, errors: {}, formError });
  try {
    if (!isPlainObject(draft) || typeof draft.version !== "number" || Number.isNaN(draft.version)) {
      return bad(FORM_MESSAGES.badDraft);
    }
    if (draft.version !== current.version) return bad(FORM_MESSAGES.formChangedElsewhere);
    const draftTypes: unknown = draft.types;
    const draftFields: unknown = draft.fields;
    if (!Array.isArray(draftTypes) || !Array.isArray(draftFields)) return bad(FORM_MESSAGES.badDraft);

    const errors: Record<string, string> = {};
    let ok = true;
    const fail = (key: string, message: string) => {
      errors[key] ??= message;
      ok = false;
    };

    // Types.
    const types = resolveItems(
      draftTypes,
      current.types,
      FORM_LIMITS.maxTypeLabel,
      (i) => `type:${i}`,
      errors,
      (label) => label.toLowerCase() === "other",
    );
    if (!types.ok) ok = false;
    if (draftTypes.length > FORM_LIMITS.maxTypes) {
      fail("types", FORM_MESSAGES.tooManyTypes(FORM_LIMITS.maxTypes));
    } else if (types.ok && removedOf(current.types, keptIds(types.resolved)).length > FORM_LIMITS.maxRemoved) {
      fail("types", FORM_MESSAGES.tooManyRemoved(FORM_LIMITS.maxRemoved));
    }

    // Details, each with its choices.
    const fields = resolveItems(draftFields, current.fields, FORM_LIMITS.maxDetailLabel, (i) => `field:${i}:label`, errors);
    if (!fields.ok) ok = false;
    if (draftFields.length > FORM_LIMITS.maxDetails) {
      fail("fields", FORM_MESSAGES.tooManyDetails(FORM_LIMITS.maxDetails));
    } else if (fields.ok && removedOf(current.fields, keptIds(fields.resolved)).length > FORM_LIMITS.maxRemoved) {
      fail("fields", FORM_MESSAGES.tooManyRemoved(FORM_LIMITS.maxRemoved));
    }

    const choices = new Map<number, { resolved: Resolved<FormOption>[]; existing: FormField | null }>();
    for (const field of fields.resolved) {
      const labelKey = `field:${field.index}:label`;
      const optionsKey = `field:${field.index}:options`;
      const { kind, required, options } = field.raw;
      if ((kind !== "text" && kind !== "dropdown") || typeof required !== "boolean") {
        fail(labelKey, FORM_MESSAGES.badDraft);
        continue;
      }
      if (field.existing && field.existing.kind !== kind) {
        fail(labelKey, FORM_MESSAGES.kindLocked);
        continue;
      }
      if (kind === "text") {
        if (options !== undefined && !(Array.isArray(options) && options.length === 0)) fail(optionsKey, FORM_MESSAGES.textHasChoices);
        continue;
      }
      const given: unknown = options === undefined ? [] : options;
      if (!Array.isArray(given)) {
        fail(optionsKey, FORM_MESSAGES.badDraft);
        continue;
      }
      const currentOptions = field.existing?.options ?? [];
      const found = resolveItems(given, currentOptions, FORM_LIMITS.maxChoiceLabel, (j) => `field:${field.index}:option:${j}`, errors);
      if (!found.ok) ok = false;
      if (given.length > FORM_LIMITS.maxChoices) {
        fail(optionsKey, FORM_MESSAGES.tooManyChoices(FORM_LIMITS.maxChoices));
      } else if (given.length < FORM_LIMITS.minChoices) {
        fail(optionsKey, FORM_MESSAGES.tooFewChoices(FORM_LIMITS.minChoices));
      } else if (found.ok && removedOf(currentOptions, keptIds(found.resolved)).length > FORM_LIMITS.maxRemoved) {
        fail(optionsKey, FORM_MESSAGES.tooManyRemoved(FORM_LIMITS.maxRemoved));
      }
      choices.set(field.index, { resolved: found.resolved, existing: field.existing });
    }
    if (!ok) return { ok: false, errors };

    // Everything is valid: make the new ids (types, then each detail followed by its choices) and build the result.
    const idFor = (taken: Set<string>, reserved: (id: string) => boolean): string => {
      for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
        const id = newId();
        if (typeof id !== "string" || id === "" || id.length > 64 || id === "__proto__" || reserved(id) || taken.has(id)) continue;
        taken.add(id);
        return id;
      }
      throw new NoIdError();
    };
    const copyOptions = (options: FormOption[]): FormOption[] =>
      options.map((option) => ({ id: option.id, label: option.label, ...(option.archived ? { archived: true } : {}) }));
    const archivedOption = (option: FormOption): FormOption => ({ id: option.id, label: option.label, archived: true });

    const takenTypeIds = new Set(current.types.map((type) => type.id));
    const nextTypes: FormType[] = [
      ...types.resolved.map((item) => ({
        id: item.existing?.id ?? idFor(takenTypeIds, (id) => id === OTHER_TYPE_ID),
        label: item.label,
      })),
      ...removedOf(current.types, keptIds(types.resolved)).map((type) => ({ id: type.id, label: type.label, archived: true as const })),
    ];

    const takenFieldIds = new Set(current.fields.map((field) => field.id));
    const activeFields: FormField[] = fields.resolved.map((item) => {
      const id = item.existing?.id ?? idFor(takenFieldIds, () => false);
      const base = { id, label: item.label, kind: item.raw.kind as "text" | "dropdown", required: item.raw.required as boolean };
      const set = choices.get(item.index);
      if (base.kind === "text" || !set) return base;
      const currentOptions = set.existing?.options ?? [];
      const takenOptionIds = new Set(currentOptions.map((option) => option.id));
      return {
        ...base,
        options: [
          ...set.resolved.map((choice) => ({ id: choice.existing?.id ?? idFor(takenOptionIds, () => false), label: choice.label })),
          ...removedOf(currentOptions, keptIds(set.resolved)).map(archivedOption),
        ],
      };
    });
    const removedFields: FormField[] = removedOf(current.fields, keptIds(fields.resolved)).map((field) => ({
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.required,
      archived: true,
      ...(field.options ? { options: copyOptions(field.options) } : {}),
    }));

    const config: FormConfig = { version: current.version + 1, types: nextTypes, fields: [...activeFields, ...removedFields] };
    // A last check with the rules the database read uses, so a bug here can never store an unreadable form.
    if (!formConfigSchema.safeParse(config).success) return bad(FORM_MESSAGES.badDraft);
    return { ok: true, config };
  } catch (error) {
    return bad(error instanceof NoIdError ? FORM_MESSAGES.couldNotSave : FORM_MESSAGES.badDraft);
  }
}
