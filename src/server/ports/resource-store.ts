import type { ResourceStatus, ResourceType } from "@/shared/resources";

export type ResourceRecord = {
  id: string;
  groupId: string;
  /** Null once the uploader's account is gone (the file stays). */
  uploaderId: string | null;
  /** The uploader's display name; empty when it is unknown or the uploader is a former member. */
  uploaderName: string;
  title: string;
  subject: string;
  type: ResourceType;
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
  subject: string;
  type: ResourceType;
  fileKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type ResourceListQuery = {
  /** Case-insensitive text found in the title, subject or file name. Blank means no search. */
  search?: string;
  /** Exact type. */
  type?: ResourceType;
  /** Exact subject, any letter case. */
  subject?: string;
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
   * src/shared/resources.ts (the database refuses them too).
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
   * Ready files only, newest first (then by id, so the order is total). The filters combine with
   * AND. `%`, `_` and `\` in the search are plain characters.
   */
  list(groupId: string, query: ResourceListQuery): Promise<ResourcePage>;
  /**
   * The subjects used by ready files, each once (letters of any case count as the same subject,
   * and the one kept is the first when compared by bytes), without the empty subject, ordered by
   * their lower-case form compared by bytes.
   */
  listSubjects(groupId: string): Promise<string[]>;
  /** Null when not found or deleted. Works while the file is still uploading. */
  update(groupId: string, id: string, d: { title: string; subject: string; type: ResourceType }): Promise<ResourceRecord | null>;
  /**
   * Marks the file deleted (the row stays) and returns it, so the caller can remove the stored
   * object by its fileKey. Null when not found or deleted already.
   */
  softDelete(groupId: string, id: string): Promise<ResourceRecord | null>;
}
