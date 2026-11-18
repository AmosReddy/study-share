import { RESOURCE_LIMITS, type ResourceStatus } from "@/shared/resources";
import type { ResourceRecord, ResourceStore } from "../ports/resource-store";
import { ANSWER_DB_LIMITS, cleanDetails, hasNul, legacyTypeKey } from "../resource-answers";
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
  /** The old `type` column: the legacy key, or `other`. Written as the database store does; nothing reads it. */
  type: string;
  typeId: string;
  typeOther: string;
  details: Record<string, string>;
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
function assertDetails(d: { title: string; typeId: string; typeOther: string; details: Record<string, string> }) {
  const titleLength = length(trimSpaces(d.title));
  if (titleLength < 1 || titleLength > RESOURCE_LIMITS.maxTitle) throw new Error("A file's title must be 1 to 120 characters.");
  const typeIdLength = length(d.typeId);
  if (typeIdLength < 1 || typeIdLength > ANSWER_DB_LIMITS.maxTypeIdLength) throw new Error("A file's type id must be 1 to 64 characters.");
  if (length(d.typeOther) > ANSWER_DB_LIMITS.maxTypeOtherLength) throw new Error("A file's Other text must be 40 characters or fewer.");
  // Postgres cannot store a NUL character in text, nor in a JSON text.
  if (hasNul(d.typeId) || hasNul(d.typeOther) || Object.entries(d.details).some(([k, v]) => hasNul(k) || hasNul(v))) {
    throw new Error("A file's answers cannot hold a NUL character.");
  }
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
      typeId: e.typeId,
      typeOther: e.typeOther,
      details: { ...e.details },
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
      if ([input.title, input.fileKey, input.fileName, input.contentType].some(hasNul)) {
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
        type: legacyTypeKey(input.typeId),
        typeId: input.typeId,
        typeOther: input.typeOther,
        details: cleanDetails(input.details),
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
      const none = { items: [], nextCursor: null };
      const limit = clampResourceLimit(query.limit);
      const text = (query.search?.text.trim() ?? "").toLowerCase();
      const details = query.details ?? [];
      // Text with a NUL character cannot be in any file, so it matches nothing.
      if (hasNul(text) || (query.typeId !== undefined && hasNul(query.typeId))) return none;
      if (details.some((d) => hasNul(d.fieldId) || hasNul(d.value))) return none;
      const typeIds = query.search?.typeIds ?? [];
      const optionIds = query.search?.optionIds ?? [];
      const textFieldIds = query.search?.textFieldIds ?? [];
      const cursor = decodeResourceCursor(query.cursor);
      // A key of the file's own details only (a detail id like "__proto__" is plain data); a missing answer is empty.
      const answer = (e: Entry, fieldId: string) => (Object.hasOwn(e.details, fieldId) ? e.details[fieldId] : "");

      const matches = readyIn(groupId)
        .filter(
          (e) =>
            text === "" ||
            [e.title, e.fileName, e.typeOther].some((t) => t.toLowerCase().includes(text)) ||
            Object.entries(e.details).some(([key, value]) => textFieldIds.includes(key) && value.toLowerCase().includes(text)) ||
            typeIds.includes(e.typeId) ||
            Object.values(e.details).some((value) => optionIds.includes(value)),
        )
        .filter((e) => query.typeId === undefined || e.typeId === query.typeId)
        .filter((e) =>
          details.every((d) =>
            d.kind === "dropdown" ? answer(e, d.fieldId) === d.value : answer(e, d.fieldId).toLowerCase() === d.value.toLowerCase(),
          ),
        )
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

    async listDetailValues(groupId, fieldId) {
      if (hasNul(fieldId)) return [];
      // One value per lower-case form, keeping the one that compares first by bytes (as the SQL
      // store's min with the "C" collation does), ordered by the lower-case form.
      const byLower = new Map<string, string>();
      for (const e of readyIn(groupId)) {
        const value = Object.hasOwn(e.details, fieldId) ? e.details[fieldId] : "";
        if (value === "") continue;
        const key = value.toLowerCase();
        const kept = byLower.get(key);
        if (kept === undefined || value < kept) byLower.set(key, value);
      }
      return [...byLower.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);
    },

    async usedOptionIds(groupId, fieldIds) {
      const byBytes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const wanted = new Set(fieldIds);
      const typeIds = new Set<string>();
      const byField = new Map<string, Set<string>>();
      for (const e of readyIn(groupId)) {
        typeIds.add(e.typeId);
        for (const [fieldId, value] of Object.entries(e.details)) {
          if (value === "" || !wanted.has(fieldId)) continue;
          byField.set(fieldId, (byField.get(fieldId) ?? new Set()).add(value));
        }
      }
      return {
        typeIds: [...typeIds].sort(byBytes),
        detailValues: Object.fromEntries([...byField].sort(([a], [b]) => byBytes(a, b)).map(([id, set]) => [id, [...set].sort(byBytes)])),
      };
    },

    async update(groupId, id, d) {
      const e = liveEntry(groupId, id);
      if (!e) return null;
      assertDetails(d);
      e.title = d.title;
      e.type = legacyTypeKey(d.typeId);
      e.typeId = d.typeId;
      e.typeOther = d.typeOther;
      e.details = cleanDetails(d.details);
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
