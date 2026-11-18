import type { ResourceStatus } from "@/shared/resources";

export type ResourceRecord = {
  id: string;
  groupId: string;
  /** Null once the uploader's account is gone (the file stays). */
  uploaderId: string | null;
  /** The uploader's display name; empty when it is unknown or the uploader is a former member. */
  uploaderName: string;
  title: string;
  /** The file's type on its group's form: a type id of the form, or `other`. Not checked against the form here. */
  typeId: string;
  /** The "Other" text; empty unless typeId is `other` (and also empty for an old Other file). */
  typeOther: string;
  /** The extra details: detail id to the typed text, or to the chosen choice id. Empty answers are not stored. */
  details: Record<string, string>;
  fileKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: ResourceStatus;
  createdAt: Date;
};

export type NewResource = {
  id: string;
  groupId: string;
  uploaderId: string;
  title: string;
  typeId: string;
  typeOther: string;
  details: Record<string, string>;
  fileKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

/** A filter on one extra detail. A text filter matches ignoring letter case, a dropdown filter matches the choice id exactly; an empty value matches files with no answer. */
export type DetailFilter = { fieldId: string; kind: "text" | "dropdown"; value: string };

/** A search the caller has already mapped onto the group's form (see searchIdsFor in src/shared/form-config.ts). */
export type ResourceSearch = {
  /** Case-insensitive plain text found in the title, file name, "Other" text or a text detail. Blank means no search. */
  text: string;
  /** Files of these types match too. */
  typeIds: string[];
  /** Files with a detail whose value is one of these choice ids match too. */
  optionIds: string[];
  /** The text details whose typed answers `text` is looked for in. */
  textFieldIds: string[];
};

export type ResourceListQuery = {
  search?: ResourceSearch;
  /** Exact type id. */
  typeId?: string;
  /** Every filter must match (AND). */
  details?: DetailFilter[];
  /** Clamped to 1..50. */
  limit: number;
  /** The `nextCursor` of the previous page. One that is not a cursor is ignored (first page). */
  cursor?: string;
};

export type ResourcePage = { items: ResourceRecord[]; nextCursor: string | null };

/**
 * The files shared in groups. A file that is not in a live group (deleted or unknown) is not
 * found by any method; the store does not know who may see what, so callers check membership first.
 */
export interface ResourceStore {
  /**
   * Records a file as 'uploading'. Throws when the group does not exist or is deleted, the
   * uploader has no account, the id or file key is taken, or a value breaks the limits in
   * src/shared/resources.ts or the answer limits (type id 1 to 64 characters, "Other" text up to
   * 40; the database refuses them too). Whether the answers fit the group's form is the caller's
   * job. The old `type` column is written as the legacy key (see legacyTypeKey).
   */
  createPending(input: NewResource): Promise<ResourceRecord>;
  /**
   * 'uploading' becomes 'ready'. A file that is ready already is returned as it is, so a retry is
   * harmless. Null for a file that is not found, is deleted, or is in another group.
   */
  markReady(id: string, groupId: string): Promise<ResourceRecord | null>;
  /** Any file that is not deleted, ready or still uploading: callers read `status` and decide. */
  findById(groupId: string, id: string): Promise<ResourceRecord | null>;
  /**
   * Ready files only, newest first (then by id, so the order is total). The type and detail
   * filters and the search combine with AND. A search matches a file when the text is in its title,
   * file name, "Other" text or a text detail named in `textFieldIds`, OR its type id is in
   * `typeIds`, OR one of its details is a choice id in `optionIds`. `%`, `_` and `\` in the text
   * are plain characters. Text that holds a NUL character matches nothing.
   */
  list(groupId: string, query: ResourceListQuery): Promise<ResourcePage>;
  /**
   * The values of one text detail used by ready files, each once (letters of any case count as the
   * same value, and the one kept is the first when compared by bytes), without the empty value,
   * ordered by their lower-case form compared by bytes.
   */
  listDetailValues(groupId: string, fieldId: string): Promise<string[]>;
  /**
   * What the ready files use: the type ids, and for each of the details named in `fieldIds` the
   * values (typed text or choice ids), each once and in byte order. Only the details asked about
   * are read (the caller passes the dropdown and the removed ones, whose values it needs), so the
   * free text of any other detail is never loaded; an id nothing has a value for is left out, and
   * ids are matched exactly. Only ready, not deleted files of a live group count, so a removed
   * type or choice shows up only while a file still uses it.
   */
  usedOptionIds(groupId: string, fieldIds: string[]): Promise<{ typeIds: string[]; detailValues: Record<string, string[]> }>;
  /** Null when not found or deleted. Works while the file is still uploading. */
  update(
    groupId: string,
    id: string,
    d: { title: string; typeId: string; typeOther: string; details: Record<string, string> },
  ): Promise<ResourceRecord | null>;
  /**
   * Marks the file deleted (the row stays) and returns it, so the caller can remove the stored
   * object by its fileKey. Null when not found or deleted already.
   */
  softDelete(groupId: string, id: string): Promise<ResourceRecord | null>;
}
