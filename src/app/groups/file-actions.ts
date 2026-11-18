"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveFormConfig } from "@/server/files/form-use-cases";
import { requireFileDeps } from "@/server/files/request-deps";
import { completeUpload, deleteFile, prepareUpload, updateFile, type FileResult } from "@/server/files/use-cases";
import { FILE_MESSAGES } from "@/shared/file-messages";
import type { SaveFormResult } from "@/shared/form-config";
import type { FormState } from "@/shared/form-state";
import { failed, text } from "../(auth)/form-data";

/*
  Thin server actions for files, like groups/actions.ts: read the input, call the use-case, turn
  its result into what the screen shows. Every one re-reads the session (requireFileDeps) and the
  use-cases re-check membership and who owns the file, so a hand-made post changes nothing it may
  not. A storage key never leaves the server: the results carry only what the screens show.

  prepareUploadAction and completeUploadAction are called from the upload form's own code (it
  sends the file to storage in between, with a progress bar), so they take plain values and answer
  with a plain result. updateFileAction and deleteFileAction are ordinary form actions.
*/

type Prepared = { resourceId: string; uploadUrl: string; headers: Record<string, string> };

/**
 * Step 1 of an upload: checks the details and the file's name, type and size, and answers with
 * the short-lived address the browser sends the file to (and the headers that go with it).
 */
export async function prepareUploadAction(groupId: string, input: unknown): Promise<FileResult<Prepared>> {
  const deps = await requireFileDeps(groupId);
  return prepareUpload(deps, groupId, input);
}

/**
 * Step 3: the file has been sent, so the server checks what arrived. On success the library is
 * refreshed and only the file's id comes back.
 */
export async function completeUploadAction(groupId: string, resourceId: string): Promise<FileResult<{ id: string }>> {
  const deps = await requireFileDeps(groupId);
  const result = await completeUpload(deps, groupId, typeof resourceId === "string" ? resourceId : "");
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return { ok: true, data: { id: result.data.id } };
}

/** The form field names of a detail are `d_<detail id>`, like the Library's address. */
const DETAIL_FIELD_PREFIX = "d_";
/** More than the form could ever hold (the use-case refuses over 40): a hand-made post cannot make this loop long. */
const MAX_DETAIL_FIELDS = 100;

/** Every `d_<id>` field of the form, as detail id to its text. Entries, not property writes: an id like "__proto__" stays plain data. */
function detailFields(form: FormData): [string, string][] {
  const entries: [string, string][] = [];
  for (const name of new Set(form.keys())) {
    if (entries.length >= MAX_DETAIL_FIELDS) break;
    if (name.startsWith(DETAIL_FIELD_PREFIX) && name.length > DETAIL_FIELD_PREFIX.length) {
      entries.push([name.slice(DETAIL_FIELD_PREFIX.length), text(form, name)]);
    }
  }
  return entries;
}

/**
 * Saves a file's title, type and details (its uploader only). The details are the form's `d_<id>`
 * fields; the use-case checks them against the group's form. What was typed comes back in `values`
 * after an error, so the fields keep it.
 */
export async function updateFileAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const fileId = text(form, "fileId");
  const deps = await requireFileDeps(groupId);
  const details = detailFields(form);
  const values = {
    title: text(form, "title"),
    type: text(form, "type"),
    typeOther: text(form, "typeOther"),
    ...Object.fromEntries(details.map(([id, value]) => [`${DETAIL_FIELD_PREFIX}${id}`, value])),
  };
  const result = await updateFile(deps, groupId, fileId, {
    title: values.title,
    typeId: values.type,
    typeOther: values.typeOther,
    details: Object.fromEntries(details),
  });
  if (!result.ok) return failed(result, values);

  revalidatePath("/", "layout");
  const saved = result.data;
  return {
    status: "done",
    notice: FILE_MESSAGES.saved,
    values: {
      title: saved.title,
      type: saved.typeId,
      typeOther: saved.typeOther,
      ...Object.fromEntries(saved.details.map((detail) => [`${DETAIL_FIELD_PREFIX}${detail.fieldId}`, detail.value])),
    },
  };
}

/** Deletes a file (its uploader or the owner) and goes back to the library, which says it was deleted. */
export async function deleteFileAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireFileDeps(groupId);
  const result = await deleteFile(deps, groupId, text(form, "fileId"));
  if (!result.ok) {
    // The file may be gone already (someone else deleted it): refresh so the pages stop showing it.
    if ("notFound" in result) revalidatePath("/", "layout");
    return failed(result, {});
  }

  revalidatePath("/", "layout");
  redirect(`/groups/${groupId}?notice=deleted`);
}

/**
 * Saves the group's upload form from the owner's editor (the owner only: anyone else gets the same
 * "not available" answer as for a group that is not there). `draft` is whatever the browser sent, so
 * the use-case checks its shape and every rule; this only turns its answer into what the screen shows.
 * On success every page is refreshed, so the upload and library screens use the new form at once.
 */
export async function saveFormConfigAction(groupId: string, draft: unknown): Promise<SaveFormResult> {
  const deps = await requireFileDeps(typeof groupId === "string" ? groupId : "");
  const result = await saveFormConfig(deps, typeof groupId === "string" ? groupId : "", draft);
  if (result.ok) {
    revalidatePath("/", "layout");
    return { ok: true, config: result.config };
  }
  return { ok: false, errors: result.errors, ...(result.formError ? { formError: result.formError } : {}) };
}
