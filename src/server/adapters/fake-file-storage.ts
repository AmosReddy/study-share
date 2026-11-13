import { randomBytes } from "node:crypto";
import type { FileStorage } from "../ports/file-storage";
import { contentDisposition, safeInlineType } from "./file-disposition";

/*
  Test-mode FileStorage, in memory. No vendor library and no network. Objects live in a Map kept on
  globalThis (like the fake auth store), so the route handler that receives an upload and the
  server code that later reads it share one copy.

  It behaves like signed URLs. createUploadUrl and createDownloadUrl hand out a URL on this app
  (/api/test/storage/<key>?token=...) whose random token is remembered with what it allows:
    - an upload token binds the key, the content type, the exact size and an expiry, and works once;
    - a download token binds the key, the expiry and how to show the file, and works until it expires.
  A request with an unknown, expired or used token, another key, another type or another size is
  refused (403), as the real storage refuses a bad signature. The disposition and name are also
  put in the URL's query so tests can read them, but the server uses what the token remembers.
*/

type StoredObject = { bytes: Uint8Array; contentType: string };

type UploadGrant = { kind: "upload"; key: string; contentType: string; sizeBytes: number; expiresAt: number };
type DownloadGrant = {
  kind: "download";
  key: string;
  expiresAt: number;
  disposition: "inline" | "attachment";
  /** The one safe type to show inline, set only when the disposition is inline. */
  inlineType: string | undefined;
  downloadName: string | undefined;
};
type Grant = UploadGrant | DownloadGrant;

export type FakeFileStorageState = {
  objects: Map<string, StoredObject>;
  /** Token to what it allows. Expired tokens are swept whenever a new one is made. */
  grants: Map<string, Grant>;
};

const STORE_KEY = "__studyShareFakeFileStorage";

/** The one state for the running process, on globalThis because Next.js can bundle routes separately. */
export function getFakeFileStorageState(): FakeFileStorageState {
  const g = globalThis as unknown as Record<string, FakeFileStorageState | undefined>;
  return (g[STORE_KEY] ??= { objects: new Map(), grants: new Map() });
}

/** Empties the shared state in place, so storages already created see the reset. */
export function resetFakeFileStorage(): void {
  const state = getFakeFileStorageState();
  state.objects.clear();
  state.grants.clear();
}

/** Where the test route lives. Its path is the key, each part encoded. */
export const FAKE_STORAGE_PATH = "/api/test/storage/";

export function fakeStorageUrl(siteUrl: string, key: string): string {
  return `${siteUrl}${FAKE_STORAGE_PATH}${key.split("/").map(encodeURIComponent).join("/")}`;
}

const sameType = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type FakeFileStorageOptions = {
  /** The address of this site, without a trailing slash. */
  siteUrl: string;
  /** Milliseconds since 1970; tests pass their own clock. */
  now?: () => number;
};

export function createFakeFileStorage({ siteUrl, now = Date.now }: FakeFileStorageOptions): FileStorage {
  const state = getFakeFileStorageState();

  const grant = (value: Grant): string => {
    const at = now();
    for (const [token, existing] of state.grants) if (existing.expiresAt <= at) state.grants.delete(token);
    const token = randomBytes(24).toString("base64url");
    state.grants.set(token, value);
    return token;
  };

  return {
    async createUploadUrl({ key, contentType, sizeBytes, expiresInSeconds }) {
      const token = grant({ kind: "upload", key, contentType, sizeBytes, expiresAt: now() + expiresInSeconds * 1000 });
      return {
        url: `${fakeStorageUrl(siteUrl, key)}?token=${token}`,
        headers: { "Content-Type": contentType },
      };
    },

    async createDownloadUrl({ key, expiresInSeconds, downloadName, preview }) {
      const inlineType = safeInlineType(preview?.contentType);
      const disposition = inlineType ? "inline" : "attachment";
      const token = grant({
        kind: "download",
        key,
        expiresAt: now() + expiresInSeconds * 1000,
        disposition,
        inlineType,
        downloadName,
      });
      const query = new URLSearchParams({ token, disposition });
      if (downloadName) query.set("name", downloadName);
      return `${fakeStorageUrl(siteUrl, key)}?${query}`;
    },

    async head(key) {
      const stored = state.objects.get(key);
      return stored ? { sizeBytes: stored.bytes.byteLength, contentType: stored.contentType } : null;
    },

    async put(key, body, contentType) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
      state.objects.set(key, { bytes, contentType });
    },

    async get(key, options) {
      const stored = state.objects.get(key);
      if (!stored) return null;
      const range = options?.range;
      return range ? stored.bytes.slice(range.start, range.endInclusive + 1) : stored.bytes.slice();
    },

    async delete(key) {
      state.objects.delete(key);
    },
  };
}

export type FakeUploadAttempt = {
  key: string;
  token: string | null;
  /** The request's Content-Type header, or null when it had none. */
  contentType: string | null;
  /** The request's Content-Length header, when it had one. */
  declaredLength: number | null;
};

/**
 * Checks a PUT against its token, before the body is read: the token must exist, be an upload
 * token, not be expired, and match the key and content type, and the declared length (when sent)
 * must be the size the URL was made for. `accept` then stores the body if it is exactly that long.
 * Returns the HTTP status to answer with when refused.
 */
export function checkFakeUpload(
  attempt: FakeUploadAttempt,
  now: () => number = Date.now,
): { ok: true; accept(body: Uint8Array): number } | { ok: false; status: number } {
  const state = getFakeFileStorageState();
  const found = attempt.token ? state.grants.get(attempt.token) : undefined;
  if (!attempt.token || !found || found.kind !== "upload" || found.expiresAt <= now() || found.key !== attempt.key) {
    return { ok: false, status: 403 };
  }
  if (attempt.contentType === null || !sameType(attempt.contentType, found.contentType)) return { ok: false, status: 403 };
  if (attempt.declaredLength !== null && attempt.declaredLength !== found.sizeBytes) return { ok: false, status: 403 };
  const token = attempt.token;
  return {
    ok: true,
    accept(body) {
      if (body.byteLength !== found.sizeBytes) return 403;
      // One use: a second PUT with the same URL is refused.
      if (!state.grants.delete(token)) return 403;
      state.objects.set(found.key, { bytes: new Uint8Array(body), contentType: found.contentType });
      return 200;
    },
  };
}

/** What a GET answers: the status, and for a hit the bytes and headers. */
export type FakeDownload =
  | { status: 200; bytes: Uint8Array; headers: Record<string, string> }
  | { status: 403 | 404 };

/**
 * Serves a stored file for a download token, with the Content-Disposition and Content-Type the
 * token was made for. Only a PDF or a common image can be inline (the same rule as the real
 * adapter, safeInlineType); anything else is an attachment. nosniff stops a browser guessing again.
 */
export function readFakeDownload(key: string, token: string | null, now: () => number = Date.now): FakeDownload {
  const state = getFakeFileStorageState();
  const found = token ? state.grants.get(token) : undefined;
  if (!found || found.kind !== "download" || found.expiresAt <= now() || found.key !== key) return { status: 403 };
  const stored = state.objects.get(key);
  if (!stored) return { status: 404 };
  const inline = found.disposition === "inline" && found.inlineType !== undefined;
  return {
    status: 200,
    bytes: stored.bytes.slice(),
    headers: {
      "Content-Type": inline ? (found.inlineType as string) : stored.contentType || "application/octet-stream",
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", found.downloadName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  };
}
