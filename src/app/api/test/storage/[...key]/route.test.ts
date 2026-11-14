import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { NextRequest } from "next/server";
import { createFakeFileStorage, getFakeFileStorageState, resetFakeFileStorage } from "@/server/adapters/fake-file-storage";
import { GET, PUT } from "./route";

const SITE = "http://localhost:3000";
const storage = () => createFakeFileStorage({ siteUrl: SITE });
const pdf = new TextEncoder().encode("%PDF-1.4 hello");

const put = (url: string, body: Uint8Array | string, headers: Record<string, string> = { "Content-Type": "application/pdf" }) =>
  PUT(new NextRequest(url, { method: "PUT", body: body as BodyInit, headers }));
const get = (url: string) => GET(new NextRequest(url));

describe("/api/test/storage/[...key]", () => {
  beforeEach(() => {
    vi.stubEnv("SERVICES_MODE", "fake");
    resetFakeFileStorage();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeFileStorage();
  });

  test("is not found outside test mode, for PUT and GET, and touches nothing", async () => {
    const { url } = await storage().createUploadUrl({ key: "k/a.pdf", contentType: "application/pdf", sizeBytes: pdf.length, expiresInSeconds: 60 });
    await storage().put("k/a.pdf", pdf, "application/pdf");
    const download = await storage().createDownloadUrl({ key: "k/a.pdf", expiresInSeconds: 60 });
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await put(url, pdf)).status).toBe(404);
      expect((await get(download)).status).toBe(404);
    }
    expect(getFakeFileStorageState().grants.size).toBe(2);
  });

  test("stores an upload that matches its link and serves it back for a download link", async () => {
    const key = "groups/g1/id1/Unit 1.pdf";
    const { url, headers } = await storage().createUploadUrl({ key, contentType: "application/pdf", sizeBytes: pdf.length, expiresInSeconds: 60 });
    expect((await put(url, pdf, headers)).status).toBe(200);
    expect(await storage().head(key)).toEqual({ sizeBytes: pdf.length, contentType: "application/pdf" });

    const preview = await get(
      await storage().createDownloadUrl({ key, expiresInSeconds: 60, downloadName: "Unit 1.pdf", preview: { contentType: "application/pdf" } }),
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toMatch(/^inline; filename="Unit 1.pdf"/);
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(pdf);

    const download = await get(await storage().createDownloadUrl({ key, expiresInSeconds: 60, downloadName: "Unit 1.pdf" }));
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="Unit 1.pdf"/);
  });

  test("a stored HTML page is never served inline, even through a preview link", async () => {
    await storage().put("k/page.html", "<script>alert(1)</script>", "text/html");
    const response = await get(await storage().createDownloadUrl({ key: "k/page.html", expiresInSeconds: 60, preview: { contentType: "text/html" } }));
    expect(response.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  test("refuses a different size, a different type, a reused link and an unknown token with 4xx and stores nothing", async () => {
    const { url, headers } = await storage().createUploadUrl({ key: "k/a.pdf", contentType: "application/pdf", sizeBytes: pdf.length, expiresInSeconds: 60 });
    expect((await put(url, new Uint8Array(pdf.length + 1), headers)).status).toBe(403);
    expect((await put(url, pdf, { "Content-Type": "text/html" })).status).toBe(403);
    expect((await put(url.replace(/token=[^&]+/, "token=nope"), pdf, headers)).status).toBe(403);
    expect((await put(url.replace(/\?.*/, ""), pdf, headers)).status).toBe(403);
    expect(await storage().head("k/a.pdf")).toBeNull();
    expect((await put(url, pdf, headers)).status).toBe(200);
    expect((await put(url, pdf, headers)).status).toBe(403);
  });

  test("a link made for one file cannot write another", async () => {
    const { url, headers } = await storage().createUploadUrl({ key: "k/a.pdf", contentType: "application/pdf", sizeBytes: pdf.length, expiresInSeconds: 60 });
    expect((await put(url.replace("k/a.pdf", "k/b.pdf"), pdf, headers)).status).toBe(403);
    expect((await put(url.replace("k/a.pdf", "k/%2e%2e/b.pdf"), pdf, headers)).status).toBe(403);
    expect(getFakeFileStorageState().objects.size).toBe(0);
  });

  test("a bad escape in the path is a 400", async () => {
    expect((await get(`${SITE}/api/test/storage/k/%E0%A4%A?token=x`)).status).toBe(400);
  });

  test("a missing file for a good link is 404, and an upload link cannot read", async () => {
    const download = await storage().createDownloadUrl({ key: "k/none.pdf", expiresInSeconds: 60 });
    expect((await get(download)).status).toBe(404);
    const { url } = await storage().createUploadUrl({ key: "k/a.pdf", contentType: "application/pdf", sizeBytes: 1, expiresInSeconds: 60 });
    await storage().put("k/a.pdf", "x", "application/pdf");
    expect((await get(url)).status).toBe(403);
  });
});
