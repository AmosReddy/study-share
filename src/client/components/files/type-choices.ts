import { activeTypes, OTHER_TYPE_ID, typeLabel, type FormConfig } from "@/shared/form-config";

/** One entry of the Type select. */
export type TypeChoice = { id: string; label: string };

/**
 * The types a member may pick on this group's form, then Other. Pass `currentTypeId` when editing
 * a file: a type that was removed from the form is still listed (marked), so the select shows what
 * the file has instead of quietly switching it to the first type. Not a client module, so server
 * pages can call it.
 */
export function typeChoices(config: FormConfig, currentTypeId?: string): TypeChoice[] {
  const choices: TypeChoice[] = activeTypes(config).map(({ id, label }) => ({ id, label }));
  const removed = config.types.find((type) => type.id === currentTypeId && type.archived);
  if (removed) choices.push({ id: removed.id, label: `${removed.label} (removed)` });
  choices.push({ id: OTHER_TYPE_ID, label: typeLabel(config, OTHER_TYPE_ID, "") });
  return choices;
}
