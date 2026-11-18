import { z } from "zod";
import { can } from "@/server/permissions";
import { actionContext, memberContext, type GroupDeps } from "@/server/groups/use-cases";
import { FORM_MESSAGES, prepareConfigForSave, type FormConfig } from "@/shared/form-config";

/*
  The group's upload form, for the owner's editor: read it (every active member may) and save it
  (only the owner, `group.form.edit`).

  Who may do what: a stranger, a plain member, a removed member, an unknown or deleted group, a
  malformed id and another group's id all get the SAME answer (`notFound`, or null for the read),
  whatever they send, so nothing says whether a group exists or who owns it. The draft is looked at
  only after the caller is known to be the owner.

  Nothing here puts an id or an error's text in a message or a log line: failures log a fixed
  sentence and answer with a fixed message from FORM_MESSAGES.
*/

/** What the editor page needs: the form, and whether this person may change it. */
export type FormEditorState = { formConfig: FormConfig; canEdit: boolean };

/** `notFound` is set for everyone who may not save; `errors` are the editor's field-level messages (see prepareConfigForSave). */
export type SaveFormOutcome =
  | { ok: true; config: FormConfig }
  | { ok: false; notFound?: true; errors: Record<string, string>; formError?: string };

const NOT_FOUND = { ok: false, notFound: true, errors: {}, formError: FORM_MESSAGES.notAvailable } as const;
const COULD_NOT_SAVE = { ok: false, errors: {}, formError: FORM_MESSAGES.couldNotSave } as const;

/**
 * The form with its group's rules, for the editor. Null for anyone who is not an active member
 * (a non-member, a removed member, an unknown or deleted group, a malformed id). Every member reads
 * the form; only the owner has `canEdit`. A store failure throws (the page's error screen).
 */
export async function getFormEditorState(deps: GroupDeps, groupId: string): Promise<FormEditorState | null> {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, "file.view", { membership: context.membership })) return null;
  return {
    formConfig: context.group.formConfig,
    canEdit: can(deps.user, "group.form.edit", { membership: context.membership }),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the draft the browser sent

/**
 * How much of a draft is looked at. The biggest form the limits allow is 5 types, 3 details and
 * 3 x 15 choices = 53 items; this leaves a little room so a draft that is only over a limit still
 * gets the editor's own message ("you can have up to 5 types"), while a draft far over is refused
 * as too big before anything is checked item by item.
 */
export const MAX_DRAFT_ITEMS = 60;
/** Text is cut to this long before it is checked, so a huge label costs nothing. It is far above any limit, so a cut label is still refused for its length. */
const MAX_RAW_LABEL = 1000;
/** Ids are at most 64 characters; one more is kept so a longer id is still seen as too long (and so unknown). */
const MAX_RAW_ID = 65;

const cut = (max: number) => z.string().transform((text) => (text.length > max ? text.slice(0, max) : text));
const rawItem = z.object({ id: cut(MAX_RAW_ID), label: cut(MAX_RAW_LABEL) });
const rawDraft = z.object({
  version: z.number().int().min(1).max(2_147_483_647),
  types: z.array(rawItem).max(MAX_DRAFT_ITEMS),
  fields: z
    .array(
      z.object({
        id: cut(MAX_RAW_ID),
        label: cut(MAX_RAW_LABEL),
        kind: z.enum(["text", "dropdown"]),
        required: z.boolean(),
        options: z.array(rawItem).max(MAX_DRAFT_ITEMS).optional(),
      }),
    )
    .max(MAX_DRAFT_ITEMS),
});

/** How many items a raw draft holds, counted without trusting its shape (anything that is not a list counts as none). */
function countItems(raw: unknown): number {
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  if (typeof raw !== "object" || raw === null) return 0;
  const { types, fields } = raw as { types?: unknown; fields?: unknown };
  let total = length(types) + length(fields);
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (typeof field === "object" && field !== null) total += length((field as { options?: unknown }).options);
    }
  }
  return total;
}

/**
 * Saves the group's upload form from the owner's draft. Only the active owner (`group.form.edit`);
 * everyone else gets `notFound`, the same answer whatever they send. The draft is cut and checked
 * for shape and size first (a shape that is not a draft gets a friendly message, a draft far over the
 * limits is "too big"), then prepareConfigForSave applies the rules and makes the new ids (`newId` is
 * for tests), and the group store writes it with a version check: a draft made from an older form
 * saves nothing and says the form changed elsewhere. Never throws.
 */
export async function saveFormConfig(
  deps: GroupDeps,
  groupId: string,
  raw: unknown,
  newId?: () => string,
): Promise<SaveFormOutcome> {
  const found = await actionContext(deps, groupId, "Could not check the group.");
  if (found.failed) return COULD_NOT_SAVE;
  const context = found.context;
  if (!context?.membership || !can(deps.user, "group.form.edit", { membership: context.membership })) return NOT_FOUND;
  const group = context.group;

  let draft: z.output<typeof rawDraft>;
  try {
    if (countItems(raw) > MAX_DRAFT_ITEMS) return { ok: false, errors: {}, formError: FORM_MESSAGES.formTooBig };
    const parsed = rawDraft.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: {}, formError: FORM_MESSAGES.badDraft };
    draft = parsed.data;
  } catch {
    return { ok: false, errors: {}, formError: FORM_MESSAGES.badDraft };
  }

  const prepared = prepareConfigForSave(group.formConfig, draft, newId);
  if (!prepared.ok) return { ok: false, errors: prepared.errors, ...(prepared.formError ? { formError: prepared.formError } : {}) };

  let written: Awaited<ReturnType<GroupDeps["groups"]["updateFormConfig"]>>;
  try {
    // The version the draft was made from (prepareConfigForSave checked it is the one just read).
    written = await deps.groups.updateFormConfig(group.id, group.formConfig.version, prepared.config);
  } catch {
    console.error("Could not save the upload form.");
    return COULD_NOT_SAVE;
  }
  if (written === "group_gone") return NOT_FOUND;
  if (written === "stale") return { ok: false, errors: {}, formError: FORM_MESSAGES.formChangedElsewhere };
  return { ok: true, config: prepared.config };
}
