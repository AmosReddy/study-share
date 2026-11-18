import { activeFields, activeOptions, activeTypes, OTHER_TYPE_ID, typeLabel, type FormConfig } from "@/shared/form-config";

/*
  What the upload and edit screens ask, worked out from the group's form. Plain functions with no
  client-only code, so a server page can call them and hand the result to a form. Removed items are
  never offered, except the one a file being edited already holds (marked "(removed)"), so the
  screen shows what the file has instead of quietly switching it.
*/

/** One entry of the Type select. */
export type TypeChoice = { id: string; label: string };

/** What the Type select calls a file's type that its group's form has no record of at all. */
export const UNKNOWN_TYPE_LABEL = "Unknown type";

/**
 * The types a member may pick on this group's form, then Other. Pass `currentTypeId` when editing
 * a file: a type that was removed from the form is still listed (marked), and so is a type the
 * form does not know at all ("Unknown type"), so the select shows what the file holds and keeps it
 * until the member picks another, instead of quietly showing the first type.
 */
export function typeChoices(config: FormConfig, currentTypeId?: string): TypeChoice[] {
  const choices: TypeChoice[] = activeTypes(config).map(({ id, label }) => ({ id, label }));
  const known = config.types.find((type) => type.id === currentTypeId);
  if (known?.archived) choices.push({ id: known.id, label: `${known.label} (removed)` });
  else if (!known && currentTypeId !== undefined && currentTypeId !== "" && currentTypeId !== OTHER_TYPE_ID) {
    choices.push({ id: currentTypeId, label: UNKNOWN_TYPE_LABEL });
  }
  choices.push({ id: OTHER_TYPE_ID, label: typeLabel(config, OTHER_TYPE_ID, "") });
  return choices;
}

/** One extra detail as the screen asks it. */
export type DetailInputSpec = {
  id: string;
  label: string;
  kind: "text" | "dropdown";
  required: boolean;
  /** A dropdown's choices, in the form's order. */
  options: { id: string; label: string }[];
  /** A text detail's suggestions: values the group already uses. */
  suggestions: string[];
};

/**
 * The form's extra details, in order, removed ones left out. `current` is the detail values of the
 * file being edited (detail id to its stored value): a removed choice it holds stays in that
 * dropdown, marked. `suggestions` is each text detail's values the group already uses.
 */
export function detailInputs(
  config: FormConfig,
  current: Record<string, string> = {},
  suggestions: Record<string, string[]> = {},
): DetailInputSpec[] {
  return activeFields(config).map((field) => {
    const held = Object.hasOwn(current, field.id) ? current[field.id] : "";
    const options = activeOptions(field).map(({ id, label }) => ({ id, label }));
    const removed = (field.options ?? []).find((option) => option.archived && option.id === held);
    if (removed) options.push({ id: removed.id, label: `${removed.label} (removed)` });
    return {
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.required,
      options: field.kind === "dropdown" ? options : [],
      suggestions: field.kind === "text" && Object.hasOwn(suggestions, field.id) ? suggestions[field.id] : [],
    };
  });
}

/**
 * True when the answers hold an error for a detail this screen does not show (the owner changed the
 * form while the person was filling it in), so the screen can say so instead of showing nothing.
 */
export function hasUnshownDetailError(errors: Record<string, string>, specs: DetailInputSpec[]): boolean {
  const shown = new Set(specs.map((spec) => `detail:${spec.id}`));
  return Object.keys(errors).some((key) => key.startsWith("detail:") && !shown.has(key));
}
