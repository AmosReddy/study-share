import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  checkFakeUpload,
  createFakeFileStorage,
  getFakeFileStorageState,
  readFakeDownload,
  resetFakeFileStorage,
} from "./fake-file-storage";
import { INLINE_SAFE_TYPES } from "./file-disposition";

const SITE = "https://app.test";
let now = 1_000_000;
const storage = () => createFakeFileStorage({ siteUrl: SITE, now: () => now });
const bytes = (...values: number[]) => new Uint8Array(values);

const tokenOf = (url: string) => new URL(url).searchParams.get("token");
const keyOf = (url: string) =>
  new URL(url).pathname.slice("/api/test/storage/".length).split("/").map(decodeURIComponent).join("/");

beforeEach(() => {
  now = 1_000_000;
  resetFakeFileStorage();
});
afterEach(() => resetFakeFileStorage());

describe("the port", () => {
  test("put, head, get and delete work on one shared in-memory copy", async () => {
    const a = storage();
    const b = storage();
    await a.put("k/one.txt", "hello", "text/plain");
    expect(await b.head("k/one.txt")).toEqual({ sizeBytes: 5, contentType: "text/plain" });
    expect(await b.get("k/one.txt")).toEqual(new TextEncoder().encode("hello"));
    await b.delete("k/one.txt");
    expect(await a.head("k/one.txt")).toBeNull();
    expect(await a.get("k/one.txt")).toBeNull();
    await expect(a.delete("k/one.txt")).resolves.toBeUndefined();
  });

  test("the state is on globalThis, so another bundle's copy of the module sees it", async () => {
    await storage().put("k", bytes(1, 2), "application/pdf");
    const g = globalThis as unknown as Record<string, { objects: Map<string, unknown> }>;
    expect(g["__studyShareFakeFileStorage"].objects.has("k")).toBe(true);
    expect(getFakeFileStorageState().objects.has("k")).toBe(true);
  });

  test("get with a range returns just those bytes, ends included, and is cut short at the end of the file", async () => {
    const s = storage();
    await s.put("k", bytes(0, 1, 2, 3, 4, 5), "text/plain");
    expect(await s.get("k", { range: { start: 1, endInclusive: 3 } })).toEqual(bytes(1, 2, 3));
    expect(await s.get("k", { range: { start: 0, endInclusive: 4095 } })).toEqual(bytes(0, 1, 2, 3, 4, 5));
    expect(await s.get("gone", { range: { start: 0, endInclusive: 3 } })).toBeNull();
  });

  test("what is returned is a copy: changing it does not change the stored file", async () => {
    const s = storage();
    await s.put("k", bytes(1, 2, 3), "text/plain");
    (await s.get("k"))![0] = 99;
    expect(await s.get("k")).toEqual(bytes(1, 2, 3));
  });

  test("reset empties the objects and the tokens in place", async () => {
    const s = storage();
    await s.put("k", "x", "text/plain");
    await s.createUploadUrl({ key: "k", contentType: "text/plain", sizeBytes: 1, expiresInSeconds: 60 });
    resetFakeFileStorage();
    expect(await s.head("k")).toBeNull();
    expect(getFakeFileStorageState().grants.size).toBe(0);
  });
});

describe("upload links", () => {
  const make = (over: Partial<Parameters<ReturnType<typeof storage>["createUploadUrl"]>[0]> = {}) =>
    storage().createUploadUrl({
      key: "groups/g 1/id/Unit #1.pdf",
      contentType: "application/pdf",
      sizeBytes: 3,
      expiresInSeconds: 600,
      ...over,
    });

  const put = (
    url: string,
    body: Uint8Array,
    contentType: string | null = "application/pdf",
    declaredLength: number | null = body.length,
  ) => checkFakeUpload({ key: keyOf(url), token: tokenOf(url), contentType, declaredLength }, () => now);

  test("the URL is on this site, carries the encoded key and a random token, and says which type to send", async () => {
    const { url, headers } = await make();
    expect(url.startsWith(`${SITE}/api/test/storage/groups/g%201/id/Unit%20%231.pdf?token=`)).toBe(true);
    expect(keyOf(url)).toBe("groups/g 1/id/Unit #1.pdf");
    expect(tokenOf(url)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(headers).toEqual({ "Content-Type": "application/pdf" });
    expect(tokenOf((await make()).url)).not.toBe(tokenOf(url));
  });

  test("the right body is stored once; the same URL then refuses", async () => {
    const { url } = await make();
    const check = put(url, bytes(1, 2, 3));
    expect(check.ok && check.accept(bytes(1, 2, 3))).toBe(200);
    expect(await storage().get("groups/g 1/id/Unit #1.pdf")).toEqual(bytes(1, 2, 3));
    expect(await storage().head("groups/g 1/id/Unit #1.pdf")).toEqual({ sizeBytes: 3, contentType: "application/pdf" });
    expect(put(url, bytes(1, 2, 3))).toEqual({ ok: false, status: 403 });
  });

  test.each([
    ["a different content type", (url: string) => put(url, bytes(1, 2, 3), "text/html")],
    ["no content type", (url: string) => put(url, bytes(1, 2, 3), null)],
    ["a different declared size", (url: string) => put(url, bytes(1, 2, 3, 4))],
    [
      "a different key",
      (url: string) =>
        checkFakeUpload({ key: "other/key.pdf", token: tokenOf(url), contentType: "application/pdf", declaredLength: 3 }, () => now),
    ],
    [
      "no token",
      (url: string) =>
        checkFakeUpload({ key: keyOf(url), token: null, contentType: "application/pdf", declaredLength: 3 }, () => now),
    ],
    [
      "an unknown token",
      (url: string) =>
        checkFakeUpload({ key: keyOf(url), token: "nope", contentType: "application/pdf", declaredLength: 3 }, () => now),
    ],
  ])("refuses %s with 403 and stores nothing", async (_name, attempt) => {
    const { url } = await make();
    expect(attempt(url)).toEqual({ ok: false, status: 403 });
    expect(getFakeFileStorageState().objects.size).toBe(0);
  });

  test("a body of the wrong length is refused even when no length was declared, and the link still works afterwards", async () => {
    const { url } = await make();
    const check = put(url, bytes(1, 2), "application/pdf", null);
    expect(check.ok && check.accept(bytes(1, 2))).toBe(403);
    expect(getFakeFileStorageState().objects.size).toBe(0);
    const again = put(url, bytes(1, 2, 3));
    expect(again.ok && again.accept(bytes(1, 2, 3))).toBe(200);
  });

  test("the content type is compared ignoring case", async () => {
    const { url } = await make();
    expect(put(url, bytes(1, 2, 3), "Application/PDF").ok).toBe(true);
  });

  test("an expired link is refused", async () => {
    const { url } = await make({ expiresInSeconds: 60 });
    now += 59_000;
    expect(put(url, bytes(1, 2, 3)).ok).toBe(true);
    now += 1_000;
    expect(put(url, bytes(1, 2, 3))).toEqual({ ok: false, status: 403 });
  });

  test("a download token cannot be used to upload", async () => {
    const url = await storage().createDownloadUrl({ key: "k", expiresInSeconds: 60 });
    expect(
      checkFakeUpload({ key: "k", token: tokenOf(url), contentType: "application/pdf", declaredLength: 1 }, () => now),
    ).toEqual({ ok: false, status: 403 });
  });

  test("expired tokens are swept when a new one is made, so the table cannot grow for ever", async () => {
    for (let i = 0; i < 5; i++) await make({ expiresInSeconds: 1 });
    now += 2_000;
    await make();
    expect(getFakeFileStorageState().grants.size).toBe(1);
  });
});

describe("download links", () => {
  const link = (input: Parameters<ReturnType<typeof storage>["createDownloadUrl"]>[0]) =>
    storage().createDownloadUrl(input);
  const serve = (url: string) => readFakeDownload(keyOf(url), tokenOf(url), () => now);

  test("the URL carries the token, the disposition and the name for tests to read", async () => {
    const url = await link({
      key: "k/a.pdf",
      expiresInSeconds: 300,
      downloadName: "Unit 1.pdf",
      preview: { contentType: "application/pdf" },
    });
    const query = new URL(url).searchParams;
    expect(url.startsWith(`${SITE}/api/test/storage/k/a.pdf?`)).toBe(true);
    expect(query.get("disposition")).toBe("inline");
    expect(query.get("name")).toBe("Unit 1.pdf");
    expect(query.get("token")).toBeTruthy();
    const plain = await link({ key: "k/a.pdf", expiresInSeconds: 300 });
    expect(new URL(plain).searchParams.get("disposition")).toBe("attachment");
    expect(new URL(plain).searchParams.has("name")).toBe(false);
  });

  test("serves the bytes inline with the safe type for a PDF or an image, and may be used more than once", async () => {
    await storage().put("k/a.png", bytes(1, 2), "image/png");
    const url = await link({
      key: "k/a.png",
      expiresInSeconds: 300,
      downloadName: "pic.png",
      preview: { contentType: "image/png" },
    });
    for (let i = 0; i < 2; i++) {
      const served = serve(url);
      expect(served.status).toBe(200);
      if (served.status === 200) {
        expect(served.headers["Content-Type"]).toBe("image/png");
        expect(served.headers["Content-Disposition"]).toBe(`inline; filename="pic.png"; filename*=UTF-8''pic.png`);
        expect(served.headers["X-Content-Type-Options"]).toBe("nosniff");
        expect(served.bytes).toEqual(bytes(1, 2));
      }
    }
  });

  test("serves a download as an attachment when no preview was asked for", async () => {
    await storage().put("k/a.pdf", bytes(1), "application/pdf");
    const served = serve(await link({ key: "k/a.pdf", expiresInSeconds: 300, downloadName: "a.pdf" }));
    expect(served.status === 200 && served.headers["Content-Disposition"]).toMatch(/^attachment; /);
  });

  // The same rule as the real adapter: only these types are ever inline.
  test.each([...INLINE_SAFE_TYPES])("%s may be inline", async (type) => {
    await storage().put("k", bytes(1), type);
    const served = serve(await link({ key: "k", expiresInSeconds: 300, preview: { contentType: type } }));
    expect(served.status === 200 && served.headers["Content-Disposition"]).toMatch(/^inline/);
  });

  test.each(["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript", "application/octet-stream", ""])(
    "%j is never inline, even when asked for as a preview",
    async (type) => {
      await storage().put("k", bytes(1), type || "text/plain");
      const url = await link({ key: "k", expiresInSeconds: 300, preview: { contentType: type } });
      expect(new URL(url).searchParams.get("disposition")).toBe("attachment");
      const served = serve(url);
      expect(served.status === 200 && served.headers["Content-Disposition"]).toMatch(/^attachment/);
    },
  );

  test("the query's disposition is only a label: the token decides", async () => {
    await storage().put("k", bytes(1), "text/html");
    const url = await link({ key: "k", expiresInSeconds: 300 });
    const tampered = url.replace("disposition=attachment", "disposition=inline");
    const served = serve(tampered);
    expect(served.status === 200 && served.headers["Content-Disposition"]).toMatch(/^attachment/);
  });

  test("refuses an unknown or expired token or another key (403) and a missing object (404)", async () => {
    await storage().put("k", bytes(1), "application/pdf");
    const url = await link({ key: "k", expiresInSeconds: 60 });
    expect(readFakeDownload("k", "nope", () => now)).toEqual({ status: 403 });
    expect(readFakeDownload("k", null, () => now)).toEqual({ status: 403 });
    expect(readFakeDownload("other", tokenOf(url), () => now)).toEqual({ status: 403 });
    await storage().delete("k");
    expect(serve(url)).toEqual({ status: 404 });
    await storage().put("k", bytes(1), "application/pdf");
    now += 60_000;
    expect(serve(url)).toEqual({ status: 403 });
  });

  test("an upload token cannot be used to read", async () => {
    await storage().put("k", bytes(1), "application/pdf");
    const { url } = await storage().createUploadUrl({
      key: "k",
      contentType: "application/pdf",
      sizeBytes: 1,
      expiresInSeconds: 60,
    });
    expect(serve(url)).toEqual({ status: 403 });
  });
});
