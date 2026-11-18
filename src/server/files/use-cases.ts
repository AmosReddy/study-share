import type { z } from "zod";
import { can, type Action } from "@/server/permissions";
import type { FileStorage } from "@/server/ports/file-storage";
import type { GroupRecord, Membership } from "@/server/ports/group-store";
import type { DetailFilter, ResourceRecord, ResourceStore } from "@/server/ports/resource-store";
import { ANSWER_DB_LIMITS } from "@/server/resource-answers";
import { overLimit, type ActionResult, type Failure } from "@/server/use-case-kit";
import { actionContext, memberContext, type GroupDeps } from "@/server/groups/use-cases";
import { FILE_MESSAGES } from "@/shared/file-messages";
import {
  detailDisplay,
  FORM_LIMITS,
  OTHER_TYPE_ID,
  searchIdsFor,
  typeLabel,
  validateAnswers,
  type Answers,
  type FormConfig,
  type FormField,
} from "@/shared/form-config";
import type { FilterOption, LibraryFilterOptions } from "@/shared/library-query";
import { answersInputSchema, fileDetailsSchema, MAX_SEARCH_LENGTH, prepareUploadSchema } from "@/shared/resource-schemas";
import { FILE_CATEGORY_LABELS, classifyUpload, isPreviewableType } from "@/shared/resources";
import { uuidSchema } from "@/shared/groups";
import { FILE_PREPARE_USER_LIMIT } from "./rate-limit-policy";
import { SNIFF_BYTES, contentMatchesType } from "./sniff";

/*
  File use-cases: start an upload, confirm it, list the library, open a file, edit its details and
  delete it. Plain functions over ports, so they run in unit tests with the fakes.

  Who may do what:
  - Every one of them first checks that the caller is an ACTIVE member of a live group, through
    groups.getMembership and can(). A stranger, a removed member, an unknown or deleted group, a
    malformed id and a file that is missing, deleted, still uploading or in another group all get
    the same answer (`notFound`, or null for the reads), so nothing says whether a file exists.
  - Editing or deleting your OWN file is not a role in the permissions table: it is decided here
    from the record's uploaderId (an active member, `file.view`, who uploaded it). Only deleting
    other people's files is a role, `file.delete.any` (the owner). Nobody edits another person's file.
  - A file is "uploading" until completeUpload has checked what reached storage. Uploading files
    are invisible: no list, link, edit or delete finds them. There is no clean-up of stale ones.

  Nothing here puts a storage key, an id or an error's text in a message or a log line: failures
  log a fixed sentence and answer with a fixed message from src/shared/file-messages.ts.
*/

export type FileDeps = GroupDeps & {
  resources: ResourceStore;
  storage: FileStorage;
};

/** A file as the pages may see it: no storage key, no uploader id. */
export type FileView = {
  id: string;
  title: string;
  /** The file's type id: one of its group's types, or `other`. */
  typeId: string;
  /** What to show: the type's label, "Other: Lab manual" or "Other". A removed type still shows its label. */
  typeLabel: string;
  /** True when the type was removed from the group's form (the file keeps it; it is not offered for new uploads). */
  typeRemoved: boolean;
  /** The "Other" text; empty unless the type is Other, and empty for an old Other file. */
  typeOther: string;
  /**
   * The group's extra details, in the form's order: the ones this file has a value for (also those
   * of a removed detail), and the form's current details it has no value for yet (`display` is "";
   * the screen may show them blank or leave them out). `display` is the typed text or the label of
   * the chosen choice, so a renamed or removed choice still reads right. `value` is what the edit
   * form starts with: the typed text, or the chosen choice's id ("" when nobody knows the choice,
   * so an unknown id never reaches a page). `valueRemoved` is true for a choice removed from its
   * dropdown; `removed` is true for a detail removed from the form.
   */
  details: { fieldId: string; label: string; display: string; value: string; valueRemoved: boolean; removed: boolean }[];
  fileName: string;
  sizeBytes: number;
  /** "Former member" when the uploader's account is gone. */
  uploaderName: string;
  /** ISO 8601. */
  uploadedAt: string;
  /** True when the browser can show it (a PDF or common image), so the page offers "Preview". */
  previewable: boolean;
  /** True for a PDF (shown in a frame); the other previewable files are images. */
  isPdf: boolean;
  /** For the caller: the uploader, or the owner. */
  canDelete: boolean;
  /** For the caller: the uploader only. */
  canEdit: boolean;
};

export type FileList = {
  items: FileView[];
  nextCursor: string | null;
  filters: LibraryFilterOptions;
};

/**
 * The Library's search and filters, as read from the address (see parseLibraryParams). Anything
 * missing is "not set". Anything that makes no sense is ignored or matches nothing: see cleanQuery.
 */
export type FileQuery = { q?: string; typeId?: string; details?: Record<string, string>; cursor?: string };

export type OpenedFile = {
  /** A short-lived link. It is made for this request after the membership check; never store it. */
  url: string;
  previewable: boolean;
  title: string;
  fileName: string;
  contentType: string;
};

/** An action's answer: the usual result, or `notFound` for everything that must look like a missing file. */
export type FileResult<T = void> = ActionResult<T> | { ok: false; notFound: true; formError: string };

export const FILE_PAGE_SIZE = 20;
/** How long the browser has to send the file after prepareUpload. */
export const UPLOAD_LINK_SECONDS = 300;
/** How long a preview or download link works. */
export const DOWNLOAD_LINK_SECONDS = 300;

const NOT_FOUND = { ok: false, notFound: true, formError: FILE_MESSAGES.notFound } as const;
const COULD_NOT_SAVE = { ok: false, formError: FILE_MESSAGES.couldNotSave } as const;

type ActionAccess = { ok: true; group: GroupRecord; membership: Membership } | typeof NOT_FOUND | typeof COULD_NOT_SAVE;

/**
 * The group and the caller's membership, when the caller is an active member who may do `action`.
 * A store failure while checking is logged as a fixed line and answers couldNotSave.
 */
async function actionAccess(deps: FileDeps, groupId: string, action: Action): Promise<ActionAccess> {
  const found = await actionContext(deps, groupId, "Could not check the group.");
  if (found.failed) return COULD_NOT_SAVE;
  const context = found.context;
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return NOT_FOUND;
  return { ok: true, group: context.group, membership: context.membership };
}

/**
 * Like actionAccess for the reads: null for anyone who may not, and a store failure THROWS (the
 * page's error screen), so an outage never turns into "not found".
 */
async function readAccess(deps: FileDeps, groupId: string, action: Action) {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return null;
  return { group: context.group, membership: context.membership };
}

/** The ready file in this group, or null for a malformed id, a missing, deleted or unfinished file. */
async function readyFile(deps: FileDeps, groupId: string, resourceId: string): Promise<ResourceRecord | null> {
  const id = uuidSchema.safeParse(resourceId);
  if (!id.success) return null;
  const record = await deps.resources.findById(groupId, id.data);
  return record?.status === "ready" ? record : null;
}

const isUploader = (deps: FileDeps, record: ResourceRecord) => record.uploaderId !== null && record.uploaderId === deps.user.id;

/** The file's details as the form's own list: see FileView.details. */
function detailViews(config: FormConfig, record: ResourceRecord): FileView["details"] {
  const views: FileView["details"] = [];
  for (const field of config.fields) {
    // Own keys only: a detail id like "constructor" must not read from the object's prototype.
    const value = Object.hasOwn(record.details, field.id) ? record.details[field.id] : "";
    if (value === "" && field.archived) continue;
    const choice = field.kind === "dropdown" ? (field.options ?? []).find((option) => option.id === value) : undefined;
    views.push({
      fieldId: field.id,
      label: field.label,
      display: detailDisplay(config, field, value),
      value: field.kind === "dropdown" && !choice ? "" : value,
      valueRemoved: choice?.archived === true,
      removed: Boolean(field.archived),
    });
  }
  return views;
}

function viewOf(deps: FileDeps, membership: Membership, config: FormConfig, record: ResourceRecord): FileView {
  const own = isUploader(deps, record);
  return {
    id: record.id,
    title: record.title,
    typeId: record.typeId,
    typeLabel: typeLabel(config, record.typeId, record.typeOther),
    typeRemoved: config.types.some((type) => type.id === record.typeId && type.archived === true),
    typeOther: record.typeOther,
    details: detailViews(config, record),
    fileName: record.fileName,
    sizeBytes: record.sizeBytes,
    uploaderName: record.uploaderName.trim() === "" ? FILE_MESSAGES.formerMember : record.uploaderName,
    uploadedAt: record.createdAt.toISOString(),
    previewable: isPreviewableType(record.contentType),
    isPdf: record.contentType === "application/pdf",
    canDelete: own || can(deps.user, "file.delete.any", { membership }),
    canEdit: own,
  };
}

type FormCheck<T> = { ok: true; data: T; answers: Answers } | { ok: false; failure: Failure };

/**
 * Checks a form that holds a title or a file as well as the answers. The schema checks the shape
 * and the title and file (its issues keep their field keys, except that the answers' keys are
 * renamed to the form's: `typeId` becomes `type` and a detail `<id>` becomes `detail:<id>`);
 * validateAnswers checks the type and details against the group's form. Both run, so a bad title
 * and a missing required detail come back together. Pass `existing` on an edit.
 */
function checkForm<S extends z.ZodType>(schema: S, raw: unknown, config: FormConfig, existing?: Answers): FormCheck<z.output<S>> {
  const parsed = schema.safeParse(raw);
  const fieldErrors: Record<string, string> = {};
  let formError: string | undefined;
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, second] = issue.path;
      if (head === "typeId") fieldErrors.type ??= issue.message;
      else if (head === "details" && typeof second === "string" && [...second].length <= ANSWER_DB_LIMITS.maxTypeIdLength) {
        fieldErrors[`detail:${second}`] ??= issue.message;
      } else if (typeof head === "string" && head !== "details") fieldErrors[head] ??= issue.message;
      else formError ??= FILE_MESSAGES.badForm;
    }
  }

  let answers: Answers | undefined;
  const given = answersInputSchema.safeParse(raw);
  if (given.success) {
    const checked = validateAnswers(config, given.data, existing);
    if (checked.ok) answers = checked.value;
    else for (const [key, message] of Object.entries(checked.errors)) fieldErrors[key] ??= message;
  }

  if (parsed.success && answers && Object.keys(fieldErrors).length === 0) return { ok: true, data: parsed.data, answers };
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  return {
    ok: false,
    failure: {
      ok: false,
      ...(hasFieldErrors ? { fieldErrors } : {}),
      ...(formError || !hasFieldErrors ? { formError: formError ?? FILE_MESSAGES.badForm } : {}),
    },
  };
}

/**
 * Starts an upload: checks the details, records the file as "uploading" and hands back a
 * short-lived link the browser sends the file to. The file type and size are bound to the link.
 * The type and the extra details are checked against the group's form AS IT IS NOW, with every rule
 * of a new upload (nothing is "unchanged"); completeUpload does not check them again, so a form
 * change while someone uploads never makes them start over. Field errors are keyed title, type,
 * typeOther, detail:<id>, fileName (a kind of file we do not take) and sizeBytes (empty or too big).
 */
export async function prepareUpload(
  deps: FileDeps,
  groupId: string,
  raw: unknown,
): Promise<FileResult<{ resourceId: string; uploadUrl: string; headers: Record<string, string> }>> {
  const access = await actionAccess(deps, groupId, "file.upload");
  if (!access.ok) return access;

  const checked = checkForm(prepareUploadSchema, raw, access.group.formConfig);
  if (!checked.ok) return checked.failure;
  const { title, fileName, contentType, sizeBytes } = checked.data;
  const { typeId, typeOther, details } = checked.answers;

  const refused = await overLimit(
    deps.limiter,
    [{ key: `file-prepare:user:${deps.user.id}`, limit: FILE_PREPARE_USER_LIMIT }],
    FILE_MESSAGES.tooMany,
  );
  if (refused) return refused;

  const resourceId = crypto.randomUUID();
  // Only ids and a plain extension in the key: file names can hold characters (Hindi, spaces, &, +)
  // that a storage service may refuse in a key. The real name lives in the database and is used
  // for the download name.
  const extension = /\.([a-z0-9]{1,8})$/.exec(fileName)?.[1];
  const fileKey = `groups/${access.group.id}/${resourceId}${extension ? `.${extension}` : ""}`;
  try {
    await deps.resources.createPending({
      id: resourceId,
      groupId: access.group.id,
      uploaderId: deps.user.id,
      title,
      typeId,
      typeOther,
      details,
      fileKey,
      fileName,
      contentType,
      sizeBytes,
    });
  } catch {
    console.error("Could not record a new upload.");
    return { ok: false, formError: FILE_MESSAGES.couldNotStartUpload };
  }

  try {
    const link = await deps.storage.createUploadUrl({
      key: fileKey,
      contentType,
      sizeBytes,
      expiresInSeconds: UPLOAD_LINK_SECONDS,
    });
    return { ok: true, data: { resourceId, uploadUrl: link.url, headers: link.headers } };
  } catch {
    console.error("Could not create an upload link.");
    // The row can never be completed, and nobody sees it; mark it deleted so it does not linger.
    await deps.resources.softDelete(access.group.id, resourceId).catch(() => {
      console.error("Could not discard an upload that did not start.");
    });
    return { ok: false, formError: FILE_MESSAGES.couldNotStartUpload };
  }
}

/** Removes a file that is not what it should be: the stored object, then the row. Each failure is logged and skipped. */
async function discardUpload(deps: FileDeps, record: ResourceRecord): Promise<void> {
  await deps.storage.delete(record.fileKey).catch(() => {
    console.error("Could not remove a rejected upload from storage.");
  });
  await deps.resources.softDelete(record.groupId, record.id).catch(() => {
    console.error("Could not discard a rejected upload.");
  });
}

/** What the stored object looks like against what was promised. */
type Inspection = "ok" | "missing" | "wrong_size" | "wrong_content";

async function inspectStoredFile(deps: FileDeps, record: ResourceRecord): Promise<Inspection> {
  const head = await deps.storage.head(record.fileKey);
  if (!head) return "missing";
  if (head.sizeBytes !== record.sizeBytes) return "wrong_size";
  const sample = await deps.storage.get(record.fileKey, {
    range: { start: 0, endInclusive: Math.min(SNIFF_BYTES, record.sizeBytes) - 1 },
  });
  if (!sample) return "missing";
  return contentMatchesType(record.contentType, sample) ? "ok" : "wrong_content";
}

/**
 * Confirms an upload once the browser has sent the file: only the uploader may. The stored object
 * must exist with exactly the recorded size, and its first bytes must fit the type (see
 * sniff.ts). A file that fails is deleted from storage and its row is marked deleted, with a
 * message saying why. A storage error (not a bad file) leaves everything as it was, so the call can
 * be repeated. Completing a file that is ready already answers ok. The answers are NOT checked
 * again (see prepareUpload), so a form that changed since the upload started does not matter.
 */
export async function completeUpload(deps: FileDeps, groupId: string, resourceId: string): Promise<FileResult<FileView>> {
  const access = await actionAccess(deps, groupId, "file.upload");
  if (!access.ok) return access;
  const id = uuidSchema.safeParse(resourceId);
  if (!id.success) return NOT_FOUND;

  try {
    const record = await deps.resources.findById(access.group.id, id.data);
    // Someone else's file looks exactly like a missing one.
    if (!record || !isUploader(deps, record)) return NOT_FOUND;
    if (record.status === "ready") return { ok: true, data: viewOf(deps, access.membership, access.group.formConfig, record) };

    const inspection = await inspectStoredFile(deps, record);
    if (inspection !== "ok") {
      await discardUpload(deps, record);
      if (inspection === "wrong_content") {
        const kind = classifyUpload(record.fileName, record.contentType);
        const label = kind.ok ? FILE_CATEGORY_LABELS[kind.category] : "file of that kind";
        return { ok: false, formError: FILE_MESSAGES.doesNotLookLike(label) };
      }
      return { ok: false, formError: FILE_MESSAGES.uploadMissing };
    }

    const ready = await deps.resources.markReady(record.id, access.group.id);
    return ready ? { ok: true, data: viewOf(deps, access.membership, access.group.formConfig, ready) } : NOT_FOUND;
  } catch {
    console.error("Could not confirm an upload.");
    return COULD_NOT_SAVE;
  }
}

/** Whitespace runs (and tabs, line breaks) become one space, then the ends are trimmed: how answers are stored. */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

const hasControl = (text: string) => /\p{Cc}/u.test(text);

/**
 * The filters as they arrive from the address bar, made safe for the store; null when no file can
 * match. Never throws, whatever is passed.
 * - The search: control characters become spaces and it is cut to MAX_SEARCH_LENGTH (cut, not refused).
 * - The type: any id up to 64 characters is passed on as it is, so a type the group does not have
 *   (an old link, a typo) simply matches nothing, as a subject nobody used did before. One that is
 *   too long or holds a control character cannot be any file's type: null.
 * - The details: only the form's own detail ids count (removed ones too, so a removed detail stays
 *   filterable); any other id is ignored, so `d_<unknown>=x` changes nothing and reads nothing.
 *   The value is tidied like a stored answer; one over the answer limit or with a control character
 *   can be no file's answer: null. A dropdown value is compared as a choice id, so it matches
 *   nothing unless it is one.
 */
function cleanQuery(
  config: FormConfig,
  query: FileQuery | null,
): { search?: string; typeId?: string; details: DetailFilter[]; cursor?: string } | null {
  const raw: FileQuery = typeof query === "object" && query !== null ? query : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const search = [...text(raw.q).replace(/\p{Cc}/gu, " ").trim()].slice(0, MAX_SEARCH_LENGTH).join("").trim();

  const typeId = text(raw.typeId).trim();
  if ([...typeId].length > ANSWER_DB_LIMITS.maxTypeIdLength || hasControl(typeId)) return null;

  const given: Record<string, unknown> =
    typeof raw.details === "object" && raw.details !== null && !Array.isArray(raw.details) ? raw.details : {};
  const details: DetailFilter[] = [];
  for (const field of config.fields) {
    if (!Object.hasOwn(given, field.id)) continue;
    const value = tidy(text(given[field.id]));
    if (value === "") continue;
    if ([...value].length > FORM_LIMITS.maxAnswer || hasControl(value)) return null;
    details.push({ fieldId: field.id, kind: field.kind, value });
  }

  return {
    ...(search ? { search } : {}),
    ...(typeId ? { typeId } : {}),
    details,
    ...(typeof raw.cursor === "string" && raw.cursor ? { cursor: raw.cursor } : {}),
  };
}

type Used = Awaited<ReturnType<ResourceStore["usedOptionIds"]>>;

/** What the Library's filters offer: see LibraryFilterOptions. */
function filterOptions(config: FormConfig, used: Used, textValues: Map<string, string[]>): LibraryFilterOptions {
  const usedTypes = new Set(used.typeIds);
  const types: FilterOption[] = [
    ...config.types
      .filter((type) => !type.archived || usedTypes.has(type.id))
      .map((type) => ({ id: type.id, label: type.label, removed: type.archived === true })),
    { id: OTHER_TYPE_ID, label: typeLabel(config, OTHER_TYPE_ID, ""), removed: false },
  ];

  const fields: LibraryFilterOptions["fields"] = [];
  for (const field of config.fields) {
    const usedValues = Object.hasOwn(used.detailValues, field.id) ? used.detailValues[field.id] : [];
    if (field.archived && usedValues.length === 0) continue;
    const options: FilterOption[] =
      field.kind === "text"
        ? (textValues.get(field.id) ?? []).map((value) => ({ id: value, label: value, removed: false }))
        : (field.options ?? [])
            .filter((option) => (field.archived || option.archived ? usedValues.includes(option.id) : true))
            .map((option) => ({ id: option.id, label: option.label, removed: option.archived === true }));
    fields.push({ id: field.id, label: field.label, kind: field.kind, removed: field.archived === true, options });
  }
  return { types, fields };
}

/**
 * One page of the group's ready files, newest first, with the filter choices. Null for anyone who
 * may not see the library. A store failure throws.
 *
 * The search looks in the title, file name, "Other" text and text details, and also finds files by
 * the label of their type or of a dropdown choice (the word is mapped to ids from the group's
 * CURRENT labels, removed ones too, so a renamed choice is still found by its new name).
 */
export async function listFiles(deps: FileDeps, groupId: string, query: FileQuery = {}): Promise<FileList | null> {
  const access = await readAccess(deps, groupId, "file.view");
  if (!access) return null;
  const config = access.group.formConfig;
  const filters = cleanQuery(config, query);

  const textFields = config.fields.filter((field) => field.kind === "text");
  const searchFor = (text: string) => ({ text, ...searchIdsFor(config, text), textFieldIds: textFields.map((field) => field.id) });
  const page = filters
    ? deps.resources.list(access.group.id, {
        ...(filters.search ? { search: searchFor(filters.search) } : {}),
        ...(filters.typeId ? { typeId: filters.typeId } : {}),
        ...(filters.details.length > 0 ? { details: filters.details } : {}),
        ...(filters.cursor ? { cursor: filters.cursor } : {}),
        limit: FILE_PAGE_SIZE,
      })
    : Promise.resolve({ items: [], nextCursor: null });

  // The values a text detail's filter offers: always for the form's current details, and for a
  // removed one only while a file still has a value for it.
  const valuesOf = async (fields: FormField[]) =>
    new Map(
      await Promise.all(
        fields.map(async (field) => [field.id, await deps.resources.listDetailValues(access.group.id, field.id)] as const),
      ),
    );
  const [found, used, activeValues] = await Promise.all([
    page,
    // Only the dropdown and the removed details: the filters need their values, never a text detail's.
    deps.resources.usedOptionIds(
      access.group.id,
      config.fields.filter((field) => field.kind === "dropdown" || field.archived).map((field) => field.id),
    ),
    valuesOf(textFields.filter((field) => !field.archived)),
  ]);
  const stillUsed = textFields.filter(
    (field) => field.archived && Object.hasOwn(used.detailValues, field.id) && used.detailValues[field.id].length > 0,
  );
  const textValues = new Map([...activeValues, ...(await valuesOf(stillUsed))]);

  return {
    items: found.items.map((record) => viewOf(deps, access.membership, config, record)),
    nextCursor: found.nextCursor,
    filters: filterOptions(config, used, textValues),
  };
}

/**
 * The group's upload form, for the upload and edit screens: every active member may read it. Null
 * for anyone else (a non-member, a removed member, an unknown or deleted group, a malformed id), as
 * for the other reads. A store failure throws.
 */
export async function getFormForGroup(deps: FileDeps, groupId: string): Promise<{ formConfig: FormConfig } | null> {
  const access = await readAccess(deps, groupId, "file.view");
  return access ? { formConfig: access.group.formConfig } : null;
}

/**
 * One ready file for the file page, as the caller may see it. Null for anyone who may not see the
 * library and for a file that is missing, deleted, unfinished or in another group. A store failure throws.
 */
export async function getFile(deps: FileDeps, groupId: string, resourceId: string): Promise<FileView | null> {
  const access = await readAccess(deps, groupId, "file.view");
  if (!access) return null;
  const record = await readyFile(deps, access.group.id, resourceId);
  return record ? viewOf(deps, access.membership, access.group.formConfig, record) : null;
}

/**
 * A short-lived link to read one ready file, made after the membership check (so a removed member
 * can never get one). `download` forces a download; otherwise a PDF or common image is shown in
 * the browser. Whether it may be shown is decided from the type we verified when the file arrived,
 * never from anything the caller sends. Null when the person may not see it or it is not there. A
 * store or storage failure throws.
 */
export async function openFile(
  deps: FileDeps,
  groupId: string,
  resourceId: string,
  { download }: { download: boolean },
): Promise<OpenedFile | null> {
  const access = await readAccess(deps, groupId, "file.view");
  if (!access) return null;
  const record = await readyFile(deps, access.group.id, resourceId);
  if (!record) return null;

  const previewable = isPreviewableType(record.contentType);
  let url: string;
  try {
    url = await deps.storage.createDownloadUrl({
      key: record.fileKey,
      expiresInSeconds: DOWNLOAD_LINK_SECONDS,
      downloadName: record.fileName,
      ...(!download && previewable ? { preview: { contentType: record.contentType } } : {}),
    });
  } catch {
    console.error("Could not create a file link.");
    throw new Error("File link failed");
  }
  return { url, previewable, title: record.title, fileName: record.fileName, contentType: record.contentType };
}

/**
 * Changes a file's title, type and details. Only the uploader (the owner cannot edit other people's
 * details). The title keeps its rules. The type and details are checked against the group's form
 * as it is now, but a value that is UNCHANGED from what the file holds always passes (a removed
 * type or choice, an old Other file with no text, a detail that became required), and the stored
 * value of a removed detail is kept, so no old file becomes uneditable. `details` is the whole
 * form: an extra detail left out counts as emptied.
 */
export async function updateFile(deps: FileDeps, groupId: string, resourceId: string, raw: unknown): Promise<FileResult<FileView>> {
  const access = await actionAccess(deps, groupId, "file.view");
  if (!access.ok) return access;

  try {
    const record = await readyFile(deps, access.group.id, resourceId);
    if (!record || !isUploader(deps, record)) return NOT_FOUND;

    const existing: Answers = { typeId: record.typeId, typeOther: record.typeOther, details: record.details };
    const checked = checkForm(fileDetailsSchema, raw, access.group.formConfig, existing);
    if (!checked.ok) return checked.failure;

    const saved = await deps.resources.update(access.group.id, record.id, { title: checked.data.title, ...checked.answers });
    return saved ? { ok: true, data: viewOf(deps, access.membership, access.group.formConfig, saved) } : NOT_FOUND;
  } catch {
    console.error("Could not save a file's details.");
    return COULD_NOT_SAVE;
  }
}

/**
 * Deletes a file: its uploader, or the owner (`file.delete.any`). The row is marked deleted first,
 * then the stored object is removed; if storage fails the file is still gone for everyone, a fixed
 * line is logged and the answer is still ok.
 */
export async function deleteFile(deps: FileDeps, groupId: string, resourceId: string): Promise<FileResult> {
  const access = await actionAccess(deps, groupId, "file.view");
  if (!access.ok) return access;

  let removed: ResourceRecord | null;
  try {
    const record = await readyFile(deps, access.group.id, resourceId);
    if (!record) return NOT_FOUND;
    if (!isUploader(deps, record) && !can(deps.user, "file.delete.any", { membership: access.membership })) return NOT_FOUND;
    removed = await deps.resources.softDelete(access.group.id, record.id);
  } catch {
    console.error("Could not delete a file.");
    return COULD_NOT_SAVE;
  }
  if (!removed) return NOT_FOUND;

  await deps.storage.delete(removed.fileKey).catch(() => {
    console.error("Could not remove a deleted file from storage.");
  });
  return { ok: true, data: undefined };
}
