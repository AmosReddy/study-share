import { DEFAULT_FORM_CONFIG, FORM_LIMITS, FORM_MESSAGES, type DraftFormConfig, type FormConfig } from "@/shared/form-config";

/*
  The owner's form editor, as plain functions so it is tested without a browser. The draft holds the
  ACTIVE items of the saved form (removed ones are neither shown nor sent). Every item has a `key`
  that only this screen uses (React keys, focus targets, where an error goes); `id` is what the
  server knows: `""` for an item that is new in this draft. The server stays the authority: the
  limits here only keep the buttons honest, and every message comes from FORM_MESSAGES.
*/

export type EditorChoice = { key: string; id: string; label: string };
export type EditorType = { key: string; id: string; label: string };
export type EditorField = {
  key: string;
  id: string;
  label: string;
  kind: "text" | "dropdown";
  required: boolean;
  /** A text detail has none that count (they are kept in case the owner switches a new detail back). */
  options: EditorChoice[];
};
export type EditorDraft = {
  /** The version of the saved form this draft started from. */
  version: number;
  /** Where the next new item's key comes from. */
  nextKey: number;
  types: EditorType[];
  fields: EditorField[];
};

export type Direction = -1 | 1;

export type EditorAction =
  | { type: "addType" }
  | { type: "removeType"; key: string }
  | { type: "renameType"; key: string; label: string }
  | { type: "moveType"; key: string; direction: Direction }
  | { type: "addField" }
  | { type: "removeField"; key: string }
  | { type: "renameField"; key: string; label: string }
  | { type: "moveField"; key: string; direction: Direction }
  | { type: "setKind"; key: string; kind: "text" | "dropdown" }
  | { type: "setRequired"; key: string; required: boolean }
  | { type: "addChoice"; fieldKey: string }
  | { type: "removeChoice"; fieldKey: string; choiceKey: string }
  | { type: "renameChoice"; fieldKey: string; choiceKey: string; label: string }
  | { type: "moveChoice"; fieldKey: string; choiceKey: string; direction: Direction }
  | { type: "replace"; draft: EditorDraft };

/** A dropdown starts with this many empty choices, so it is valid as soon as they are named. */
const STARTING_CHOICES = FORM_LIMITS.minChoices;

const existingKey = (id: string) => `e:${id}`;

/** The draft for a saved form: its active items, in order, each keeping its id. */
export function draftFromConfig(config: FormConfig): EditorDraft {
  return {
    version: config.version,
    nextKey: 1,
    types: config.types.filter((type) => !type.archived).map((type) => ({ key: existingKey(type.id), id: type.id, label: type.label })),
    fields: config.fields
      .filter((field) => !field.archived)
      .map((field) => ({
        key: existingKey(field.id),
        id: field.id,
        label: field.label,
        kind: field.kind,
        required: field.required,
        options: (field.options ?? [])
          .filter((option) => !option.archived)
          .map((option) => ({ key: existingKey(option.id), id: option.id, label: option.label })),
      })),
  };
}

/** What is sent to the server: no keys, and only a dropdown has choices. */
export function toDraftFormConfig(draft: EditorDraft): DraftFormConfig {
  return {
    version: draft.version,
    types: draft.types.map(({ id, label }) => ({ id, label })),
    fields: draft.fields.map((field) => ({
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.required,
      ...(field.kind === "dropdown" ? { options: field.options.map(({ id, label }) => ({ id, label })) } : {}),
    })),
  };
}

/** True when the draft differs from what was last saved (or loaded). */
export function isDirty(draft: EditorDraft, saved: EditorDraft): boolean {
  return JSON.stringify(toDraftFormConfig(draft)) !== JSON.stringify(toDraftFormConfig(saved));
}

/**
 * What the draft becomes after `sent` (an earlier snapshot of it) was saved as `config`, when the
 * draft has changed since the snapshot was taken: the changes are kept, and the items that were new
 * in `sent` now carry the ids the server gave them (the saved form lists its active items in the
 * order they were sent), so the next save updates them instead of adding them again. The version is
 * the saved one. Items added after the snapshot stay new.
 */
export function rebaseDraft(current: EditorDraft, sent: EditorDraft, config: FormConfig): EditorDraft {
  const savedDraft = draftFromConfig(config);
  const typeIds = new Map<string, string>();
  const fieldIds = new Map<string, string>();
  const choiceIds = new Map<string, string>();
  sent.types.forEach((type, i) => {
    const made = savedDraft.types[i];
    if (type.id === "" && made) typeIds.set(type.key, made.id);
  });
  sent.fields.forEach((field, i) => {
    const made = savedDraft.fields[i];
    if (!made) return;
    if (field.id === "") fieldIds.set(field.key, made.id);
    field.options.forEach((choice, j) => {
      const madeChoice = made.options[j];
      if (field.kind === "dropdown" && choice.id === "" && madeChoice) choiceIds.set(`${field.key}/${choice.key}`, madeChoice.id);
    });
  });
  return {
    ...current,
    version: config.version,
    types: current.types.map((type) => (type.id === "" && typeIds.has(type.key) ? { ...type, id: typeIds.get(type.key)! } : type)),
    fields: current.fields.map((field) => ({
      ...field,
      id: field.id === "" && fieldIds.has(field.key) ? fieldIds.get(field.key)! : field.id,
      options: field.options.map((choice) =>
        choice.id === "" && choiceIds.has(`${field.key}/${choice.key}`)
          ? { ...choice, id: choiceIds.get(`${field.key}/${choice.key}`)! }
          : choice,
      ),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Counters and limits

/** Title and Type are always there, then each extra detail. */
export const FIXED_FIELDS = 2;

export function fieldsUsed(draft: EditorDraft): number {
  return FIXED_FIELDS + draft.fields.length;
}

export function fieldsUsedText(draft: EditorDraft): string {
  return `${fieldsUsed(draft)} of ${FORM_LIMITS.maxFields} fields used`;
}

/** Why another type cannot be added, or null when it can. */
export function typeAddBlocked(draft: EditorDraft): string | null {
  return draft.types.length >= FORM_LIMITS.maxTypes ? FORM_MESSAGES.tooManyTypes(FORM_LIMITS.maxTypes) : null;
}

/** Why another detail cannot be added, or null when it can. */
export function fieldAddBlocked(draft: EditorDraft): string | null {
  return draft.fields.length >= FORM_LIMITS.maxDetails ? FORM_MESSAGES.tooManyDetails(FORM_LIMITS.maxDetails) : null;
}

/** Why another choice cannot be added to this dropdown, or null when it can. */
export function choiceAddBlocked(field: EditorField): string | null {
  return field.options.length >= FORM_LIMITS.maxChoices ? FORM_MESSAGES.tooManyChoices(FORM_LIMITS.maxChoices) : null;
}

// ---------------------------------------------------------------------------------------------
// Changing the draft

function move<T>(list: T[], index: number, direction: Direction): T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function mapField(draft: EditorDraft, key: string, change: (field: EditorField) => EditorField): EditorDraft {
  if (!draft.fields.some((field) => field.key === key)) return draft;
  return { ...draft, fields: draft.fields.map((field) => (field.key === key ? change(field) : field)) };
}

function newItem(draft: EditorDraft): { key: string; draft: EditorDraft } {
  return { key: `n${draft.nextKey}`, draft: { ...draft, nextKey: draft.nextKey + 1 } };
}

function withChoices(draft: EditorDraft, count: number): { draft: EditorDraft; choices: EditorChoice[] } {
  let current = draft;
  const choices: EditorChoice[] = [];
  for (let i = 0; i < count; i++) {
    const made = newItem(current);
    current = made.draft;
    choices.push({ key: made.key, id: "", label: "" });
  }
  return { draft: current, choices };
}

/** The reducer of the editor. A change the limits do not allow, or one for an item that is not there, returns the same draft. */
export function editorReducer(draft: EditorDraft, action: EditorAction): EditorDraft {
  switch (action.type) {
    case "replace":
      return action.draft;

    case "addType": {
      if (typeAddBlocked(draft)) return draft;
      const made = newItem(draft);
      return { ...made.draft, types: [...made.draft.types, { key: made.key, id: "", label: "" }] };
    }
    case "removeType":
      return draft.types.some((type) => type.key === action.key)
        ? { ...draft, types: draft.types.filter((type) => type.key !== action.key) }
        : draft;
    case "renameType":
      return { ...draft, types: draft.types.map((type) => (type.key === action.key ? { ...type, label: action.label } : type)) };
    case "moveType": {
      const types = move(
        draft.types,
        draft.types.findIndex((type) => type.key === action.key),
        action.direction,
      );
      return types === draft.types ? draft : { ...draft, types };
    }

    case "addField": {
      if (fieldAddBlocked(draft)) return draft;
      const made = newItem(draft);
      return {
        ...made.draft,
        fields: [...made.draft.fields, { key: made.key, id: "", label: "", kind: "text", required: false, options: [] }],
      };
    }
    case "removeField":
      return draft.fields.some((field) => field.key === action.key)
        ? { ...draft, fields: draft.fields.filter((field) => field.key !== action.key) }
        : draft;
    case "renameField":
      return mapField(draft, action.key, (field) => ({ ...field, label: action.label }));
    case "moveField": {
      const fields = move(
        draft.fields,
        draft.fields.findIndex((field) => field.key === action.key),
        action.direction,
      );
      return fields === draft.fields ? draft : { ...draft, fields };
    }
    case "setKind": {
      const target = draft.fields.find((field) => field.key === action.key);
      // The kind of a detail that already exists is locked (the server refuses a change too).
      if (!target || target.id !== "" || target.kind === action.kind) return draft;
      if (action.kind === "dropdown" && target.options.length === 0) {
        const made = withChoices(draft, STARTING_CHOICES);
        return mapField(made.draft, action.key, (field) => ({ ...field, kind: "dropdown", options: made.choices }));
      }
      return mapField(draft, action.key, (field) => ({ ...field, kind: action.kind }));
    }
    case "setRequired":
      return mapField(draft, action.key, (field) => ({ ...field, required: action.required }));

    case "addChoice": {
      const target = draft.fields.find((field) => field.key === action.fieldKey);
      if (!target || target.kind !== "dropdown" || choiceAddBlocked(target)) return draft;
      const made = newItem(draft);
      return mapField(made.draft, action.fieldKey, (field) => ({
        ...field,
        options: [...field.options, { key: made.key, id: "", label: "" }],
      }));
    }
    case "removeChoice":
      return mapField(draft, action.fieldKey, (field) => ({
        ...field,
        options: field.options.filter((choice) => choice.key !== action.choiceKey),
      }));
    case "renameChoice":
      return mapField(draft, action.fieldKey, (field) => ({
        ...field,
        options: field.options.map((choice) => (choice.key === action.choiceKey ? { ...choice, label: action.label } : choice)),
      }));
    case "moveChoice":
      return mapField(draft, action.fieldKey, (field) => ({
        ...field,
        options: move(
          field.options,
          field.options.findIndex((choice) => choice.key === action.choiceKey),
          action.direction,
        ),
      }));
  }
}

// ---------------------------------------------------------------------------------------------
// Defaults

const sameLabel = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The draft for "Use these defaults": the default form's items, in its order, keeping the version
 * of the draft it replaces. An item the saved form already has (the same name, else the same
 * original id) keeps its id, so files that use it keep it; everything else is new. Nothing is
 * saved: the owner reviews it and presses Save.
 */
export function defaultsDraft(saved: FormConfig, current: EditorDraft): EditorDraft {
  let nextKey = current.nextKey;
  const take = () => `n${nextKey++}`;
  const types: EditorType[] = [];
  const fields: EditorField[] = [];

  const usedTypes = new Set<string>();
  const savedTypes = saved.types.filter((type) => !type.archived);
  for (const wanted of DEFAULT_FORM_CONFIG.types) {
    const match =
      savedTypes.find((type) => !usedTypes.has(type.id) && sameLabel(type.label, wanted.label)) ??
      savedTypes.find((type) => !usedTypes.has(type.id) && type.id === wanted.id);
    if (match) usedTypes.add(match.id);
    types.push({ key: match ? existingKey(match.id) : take(), id: match?.id ?? "", label: wanted.label });
  }

  const usedFields = new Set<string>();
  const savedFields = saved.fields.filter((field) => !field.archived);
  for (const wanted of DEFAULT_FORM_CONFIG.fields) {
    const fits = (field: { id: string; kind: string }) => !usedFields.has(field.id) && field.kind === wanted.kind;
    const match =
      savedFields.find((field) => fits(field) && sameLabel(field.label, wanted.label)) ??
      savedFields.find((field) => fits(field) && field.id === wanted.id);
    if (match) usedFields.add(match.id);
    fields.push({
      key: match ? existingKey(match.id) : take(),
      id: match?.id ?? "",
      label: wanted.label,
      kind: wanted.kind,
      required: wanted.required,
      options: [],
    });
  }
  return { version: current.version, nextKey, types, fields };
}

// ---------------------------------------------------------------------------------------------
// The preview

/** What a nameless item is called in the preview. */
export const UNNAMED = "(no name yet)";

/**
 * The draft as a FormConfig the member's upload-form fields can be built from: items that are new
 * get a temporary id, and an item without a name yet is shown as UNNAMED. Never saved.
 */
export function previewConfig(draft: EditorDraft): FormConfig {
  const shown = (label: string) => (label.trim() === "" ? UNNAMED : label);
  return {
    version: draft.version,
    types: draft.types.map((type) => ({ id: type.id || `new-${type.key}`, label: shown(type.label) })),
    fields: draft.fields.map((field) => ({
      id: field.id || `new-${field.key}`,
      label: shown(field.label),
      kind: field.kind,
      required: field.required,
      ...(field.kind === "dropdown"
        ? { options: field.options.map((choice) => ({ id: choice.id || `new-${choice.key}`, label: shown(choice.label) })) }
        : {}),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Errors

/**
 * The server's field-level errors (keys by position in the draft that was sent) as errors by item
 * key, so each stays with its item when the owner reorders things afterwards:
 * `types`, `type:<key>`, `fields`, `field:<key>:label`, `field:<key>:options`,
 * `field:<key>:option:<key>`. One that fits no item (a stale draft) goes under `form`.
 */
export function errorsByKey(draft: EditorDraft, errors: Record<string, string>): Record<string, string> {
  const keyed: Record<string, string> = {};
  const put = (key: string, message: string) => {
    keyed[key] ??= message;
  };
  for (const [name, message] of Object.entries(errors)) {
    const parts = name.split(":");
    const index = (value: string | undefined) => (value !== undefined && /^\d+$/.test(value) ? Number(value) : -1);
    if (name === "types" || name === "fields") {
      put(name, message);
    } else if (parts[0] === "type" && parts.length === 2) {
      const type = draft.types[index(parts[1])];
      put(type ? `type:${type.key}` : "form", message);
    } else if (parts[0] === "field" && parts[2] === "label" && parts.length === 3) {
      const field = draft.fields[index(parts[1])];
      put(field ? `field:${field.key}:label` : "form", message);
    } else if (parts[0] === "field" && parts[2] === "options" && parts.length === 3) {
      const field = draft.fields[index(parts[1])];
      put(field ? `field:${field.key}:options` : "form", message);
    } else if (parts[0] === "field" && parts[2] === "option" && parts.length === 4) {
      const field = draft.fields[index(parts[1])];
      const choice = field?.options[index(parts[3])];
      put(field && choice ? `field:${field.key}:option:${choice.key}` : "form", message);
    } else {
      put("form", message);
    }
  }
  return keyed;
}

/** The error keys that stop applying when a change is made to the item or list they belong to. */
export function clearErrors(errors: Record<string, string>, ...keys: string[]): Record<string, string> {
  if (keys.every((key) => !(key in errors))) return errors;
  const rest = { ...errors };
  for (const key of keys) delete rest[key];
  return rest;
}
