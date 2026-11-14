import { can, type Action } from "@/server/permissions";
import type { FileStorage } from "@/server/ports/file-storage";
import type { GroupRecord, Membership } from "@/server/ports/group-store";
import type { ResourceRecord, ResourceStore } from "@/server/ports/resource-store";
import { overLimit, parse, type ActionResult } from "@/server/use-case-kit";
import { actionContext, memberContext, type GroupDeps } from "@/server/groups/use-cases";
import { FILE_MESSAGES } from "@/shared/file-messages";
import { fileDetailsSchema, MAX_SEARCH_LENGTH, prepareUploadSchema } from "@/shared/resource-schemas";
import {
  FILE_CATEGORY_LABELS,
  RESOURCE_LIMITS,
  RESOURCE_TYPES,
  RESOURCE_TYPE_VALUES,
  classifyUpload,
  isPreviewableType,
  type ResourceType,
} from "@/shared/resources";
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
  subject: string;
  type: ResourceType;
  typeLabel: string;
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
  /** Every subject the group's files use, for the filter. */
  subjects: string[];
};

export type FileQuery = { search?: string; type?: string; subject?: string; cursor?: string };

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

function viewOf(deps: FileDeps, membership: Membership, record: ResourceRecord): FileView {
  const own = isUploader(deps, record);
  return {
    id: record.id,
    title: record.title,
    subject: record.subject,
    type: record.type,
    typeLabel: RESOURCE_TYPES[record.type],
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

/**
 * Starts an upload: checks the details, records the file as "uploading" and hands back a
 * short-lived link the browser sends the file to. The file type and size are bound to the link.
 * Field errors are keyed title, subject, type, fileName (a kind of file we do not take) and
 * sizeBytes (empty or too big).
 */
export async function prepareUpload(
  deps: FileDeps,
  groupId: string,
  raw: unknown,
): Promise<FileResult<{ resourceId: string; uploadUrl: string; headers: Record<string, string> }>> {
  const access = await actionAccess(deps, groupId, "file.upload");
  if (!access.ok) return access;

  const parsed = parse(prepareUploadSchema, raw, FILE_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;
  const { title, subject, type, fileName, contentType, sizeBytes } = parsed.data;

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
      subject,
      type,
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
 * be repeated. Completing a file that is ready already answers ok.
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
    if (record.status === "ready") return { ok: true, data: viewOf(deps, access.membership, record) };

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
    return ready ? { ok: true, data: viewOf(deps, access.membership, ready) } : NOT_FOUND;
  } catch {
    console.error("Could not confirm an upload.");
    return COULD_NOT_SAVE;
  }
}

/** The filters as they arrive from the address bar, made safe for the store; null when no file can match. */
function cleanQuery(raw: FileQuery): { search?: string; type?: ResourceType; subject?: string; cursor?: string } | null {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  // Control characters (a NUL would make Postgres throw) become spaces; a search is cut, not refused.
  const search = [...text(raw.search).replace(/\p{Cc}/gu, " ").trim()].slice(0, MAX_SEARCH_LENGTH).join("").trim();
  const subject = text(raw.subject).trim();
  // No file can have a subject that is too long or holds a control character: it matches nothing.
  if ([...subject].length > RESOURCE_LIMITS.maxSubject || /\p{Cc}/u.test(subject)) return null;
  const type = RESOURCE_TYPE_VALUES.find((value) => value === raw.type);
  return {
    ...(search ? { search } : {}),
    ...(type ? { type } : {}),
    ...(subject ? { subject } : {}),
    ...(typeof raw.cursor === "string" && raw.cursor ? { cursor: raw.cursor } : {}),
  };
}

/**
 * One page of the group's ready files, newest first, with the filter choices. Null for anyone who
 * may not see the library. A store failure throws.
 */
export async function listFiles(deps: FileDeps, groupId: string, query: FileQuery = {}): Promise<FileList | null> {
  const access = await readAccess(deps, groupId, "file.view");
  if (!access) return null;
  const filters = cleanQuery(query);
  const [page, subjects] = await Promise.all([
    filters ? deps.resources.list(access.group.id, { ...filters, limit: FILE_PAGE_SIZE }) : { items: [], nextCursor: null },
    deps.resources.listSubjects(access.group.id),
  ]);
  return {
    items: page.items.map((record) => viewOf(deps, access.membership, record)),
    nextCursor: page.nextCursor,
    subjects,
  };
}

/**
 * One ready file for the file page, as the caller may see it. Null for anyone who may not see the
 * library and for a file that is missing, deleted, unfinished or in another group. A store failure throws.
 */
export async function getFile(deps: FileDeps, groupId: string, resourceId: string): Promise<FileView | null> {
  const access = await readAccess(deps, groupId, "file.view");
  if (!access) return null;
  const record = await readyFile(deps, access.group.id, resourceId);
  return record ? viewOf(deps, access.membership, record) : null;
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

/** Changes a file's title, subject and type. Only the uploader (the owner cannot edit other people's details). */
export async function updateFile(deps: FileDeps, groupId: string, resourceId: string, raw: unknown): Promise<FileResult<FileView>> {
  const access = await actionAccess(deps, groupId, "file.view");
  if (!access.ok) return access;

  try {
    const record = await readyFile(deps, access.group.id, resourceId);
    if (!record || !isUploader(deps, record)) return NOT_FOUND;

    const parsed = parse(fileDetailsSchema, raw, FILE_MESSAGES.badForm);
    if ("failure" in parsed) return parsed.failure;

    const saved = await deps.resources.update(access.group.id, record.id, parsed.data);
    return saved ? { ok: true, data: viewOf(deps, access.membership, saved) } : NOT_FOUND;
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
