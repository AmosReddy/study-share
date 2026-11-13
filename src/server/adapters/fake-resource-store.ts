import { RESOURCE_LIMITS, RESOURCE_TYPE_VALUES, type ResourceStatus, type ResourceType } from "@/shared/resources";
import type { ResourceRecord, ResourceStore } from "../ports/resource-store";
import { clampResourceLimit, decodeResourceCursor, encodeResourceCursor } from "../resource-cursor";
import { getFakeAuthStore, type FakeAuthStore } from "./fake-auth-provider";
import { isFakeGroupLive } from "./fake-group-store";

/*
  Test-mode ResourceStore, in memory. Every method is one synchronous section, so each is atomic.
  It refuses what the database refuses (a missing group or uploader, a taken id or file key, a
  value outside the limits), takes uploader names from the fake auth store as the SQL store reads
  them from the profiles, and treats a group the fake group store has deleted as gone.
*/

type Entry = {
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
  status: ResourceStatus;
  createdAt: Date;
  deletedAt: Date | null;
};

export type FakeResourceStoreState = {
  /** File id to file. Deleted files stay, as in the database, and every read skips them. */
  resources: Map<string, Entry>;
};

const STORE_KEY = "__studyShareFakeResourceStore";

/**
 * The one state for the running process, on globalThis because Next.js can bundle server actions
 * and route handlers separately, and each bundle would otherwise get its own copy.
 */
function getState(): FakeResourceStoreState {
  const g = globalThis as unknown as Record<string, FakeResourceStoreState | undefined>;
  return (g[STORE_KEY] ??= { resources: new Map() });
}

/** Empties the shared state in place, so stores already created see the reset. */
export function resetFakeResourceStore(): void {
  getState().resources.clear();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Characters people see (code points), as the database's char_length counts them. */
const length = (text: string) => [...text].length;

/** The database's btrim: spaces only. */
const trimSpaces = (text: string) => text.replace(/^ +| +$/g, "");

/** The rules the database enforces with check constraints; breaking one throws, as an insert would. */
function assertDetails(d: { title: string; subject: string; type: string }) {
  if (!(RESOURCE_TYPE_VALUES as string[]).includes(d.type)) throw new Error("A file's type must be one of the known types.");
  const titleLength = length(trimSpaces(d.title));
  if (titleLength < 1 || titleLength > RESOURCE_LIMITS.maxTitle) throw new Error("A file's title must be 1 to 120 characters.");
  if (length(d.subject) > RESOURCE_LIMITS.maxSubject) throw new Error("A file's subject must be 60 characters or fewer.");
}

export function createFakeResourceStore(authStore: FakeAuthStore = getFakeAuthStore()): ResourceStore {
  const state = getState();

  const toRecord = (e: Entry): ResourceRecord => {
    const uploader = authStore.users.get(e.uploaderId);
    return {
      id: e.id,
      groupId: e.groupId,
      // The database clears the uploader when the account is deleted.
      uploaderId: uploader ? e.uploaderId : null,
      uploaderName: uploader?.displayName ?? "",
      title: e.title,
      subject: e.subject,
      type: e.type,
      fileKey: e.fileKey,
      fileName: e.fileName,
      contentType: e.contentType,
      sizeBytes: e.sizeBytes,
      status: e.status,
      createdAt: new Date(e.createdAt),
    };
  };

  /** The file when it is not deleted, is in this group, and the group is live. */
  const liveEntry = (groupId: string, id: string): Entry | undefined => {
    const e = state.resources.get(id.toLowerCase());
    if (!e || e.deletedAt || e.groupId !== groupId.toLowerCase() || !isFakeGroupLive(e.groupId)) return undefined;
    return e;
  };

  /** The files of a live group that are ready and not deleted. */
  const readyIn = (groupId: string): Entry[] => {
    const gid = groupId.toLowerCase();
    if (!isFakeGroupLive(gid)) return [];
    return [...state.resources.values()].filter((e) => e.groupId === gid && e.status === "ready" && !e.deletedAt);
  };

  return {
    async createPending(input) {
      if (!UUID.test(input.id) || !UUID.test(input.groupId) || !UUID.test(input.uploaderId)) {
        throw new Error("createPending needs uuids for the file, the group and the uploader.");
      }
      const id = input.id.toLowerCase();
      const groupId = input.groupId.toLowerCase();
      if (!isFakeGroupLive(groupId)) throw new Error("createPending: the group does not exist or is deleted.");
      const uploaderId = input.uploaderId.toLowerCase();
      if (!authStore.users.has(uploaderId)) throw new Error("createPending: the uploader has no account.");
      // Postgres cannot store a NUL character in text.
      if ([input.title, input.subject, input.fileKey, input.fileName, input.contentType].some((t) => t.includes("0000"))) {
        throw new Error("createPending: text cannot hold a NUL character.");
      }
      assertDetails(input);
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new Error("A file's size must be above zero.");
      const nameLength = length(input.fileName);
      if (nameLength < 1 || nameLength > RESOURCE_LIMITS.maxFileName) throw new Error("A file's name must be 1 to 200 characters.");
      if (state.resources.has(id)) throw new Error("createPending: that file id is taken.");
      for (const e of state.resources.values()) {
        if (e.fileKey === input.fileKey) throw new Error("createPending: that file key is taken.");
      }
      const entry: Entry = {
        id,
        groupId,
        uploaderId,
        title: input.title,
        subject: input.subject,
        type: input.type,
        fileKey: input.fileKey,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        status: "uploading",
        createdAt: new Date(),
        deletedAt: null,
      };
      state.resources.set(id, entry);
      return toRecord(entry);
    },

    async markReady(id, groupId) {
      const e = liveEntry(groupId, id);
      if (!e) return null;
      e.status = "ready";
      return toRecord(e);
    },

    async findById(groupId, id) {
      const e = liveEntry(groupId, id);
      return e ? toRecord(e) : null;
    },

    async list(groupId, query) {
      const limit = clampResourceLimit(query.limit);
      const search = (query.search?.trim() ?? "").toLowerCase();
      const subject = query.subject?.toLowerCase();
      const cursor = decodeResourceCursor(query.cursor);
      const matches = readyIn(groupId)
        .filter((e) => search === "" || [e.title, e.subject, e.fileName].some((t) => t.toLowerCase().includes(search)))
        .filter((e) => query.type === undefined || e.type === query.type)
        .filter((e) => subject === undefined || e.subject.toLowerCase() === subject)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .filter((e) => {
          if (!cursor) return true;
          const micros = e.createdAt.getTime() * 1000;
          return micros < cursor.micros || (micros === cursor.micros && e.id < cursor.id);
        });
      const page = matches.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toRecord),
        nextCursor: matches.length > limit ? encodeResourceCursor({ micros: last.createdAt.getTime() * 1000, id: last.id }) : null,
      };
    },

    async listSubjects(groupId) {
      // One subject per lower-case form, keeping the one that compares first by bytes (as the
      // SQL store's min with the "C" collation does), ordered by the lower-case form.
      const byLower = new Map<string, string>();
      for (const e of readyIn(groupId)) {
        if (e.subject === "") continue;
        const key = e.subject.toLowerCase();
        const kept = byLower.get(key);
        if (kept === undefined || e.subject < kept) byLower.set(key, e.subject);
      }
      return [...byLower.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, subject]) => subject);
    },

    async update(groupId, id, d) {
      const e = liveEntry(groupId, id);
      if (!e) return null;
      assertDetails(d);
      e.title = d.title;
      e.subject = d.subject;
      e.type = d.type;
      return toRecord(e);
    },

    async softDelete(groupId, id) {
      const e = liveEntry(groupId, id);
      if (!e) return null;
      e.deletedAt = new Date();
      return toRecord(e);
    },
  };
}
