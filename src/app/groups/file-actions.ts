"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFileDeps } from "@/server/files/request-deps";
import { completeUpload, deleteFile, prepareUpload, updateFile, type FileResult } from "@/server/files/use-cases";
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

/** Saves a file's title, type and subject (its uploader only). */
export async function updateFileAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const fileId = text(form, "fileId");
  const deps = await requireFileDeps(groupId);
  const values = { title: text(form, "title"), subject: text(form, "subject"), type: text(form, "type") };
  const result = await updateFile(deps, groupId, fileId, values);
  if (!result.ok) return failed(result, values);

  revalidatePath("/", "layout");
  const saved = result.data;
  return {
    status: "done",
    notice: "Saved.",
    values: { title: saved.title, subject: saved.subject, type: saved.type },
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
