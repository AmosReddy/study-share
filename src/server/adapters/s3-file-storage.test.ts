import { describe, expect, test } from "vitest";
import { createS3FileStorage } from "./s3-file-storage";

const config = {
  endpoint: "https://abc.storage.supabase.co/storage/v1/s3",
  region: "ap-south-1",
  accessKeyId: "AKIATESTKEY",
  secretAccessKey: "super-secret-value",
  bucket: "test-bucket",
  forcePathStyle: true,
};

describe("createS3FileStorage", () => {
  const storage = createS3FileStorage(config);

  test("upload URL points at the bucket and key, expires, and hides the secret", async () => {
    const { url, headers } = await storage.createUploadUrl({
      key: "groups/g1/file.pdf",
      contentType: "application/pdf",
      sizeBytes: 1234,
      expiresInSeconds: 300,
    });
    expect(url.startsWith("https://abc.storage.supabase.co/storage/v1/s3/test-bucket/groups/g1/file.pdf?")).toBe(
      true,
    );
    expect(url).toContain("X-Amz-Expires=300");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).not.toContain("super-secret-value");
    expect(headers).toEqual({ "Content-Type": "application/pdf" });
  });

  test("upload URL binds the content type, so a different type cannot be uploaded with it", async () => {
    const { url } = await storage.createUploadUrl({
      key: "k",
      contentType: "application/pdf",
      sizeBytes: 10,
      expiresInSeconds: 60,
    });
    expect(decodeURIComponent(new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "")).toContain("content-type");
  });

  test("download URL forces a download by default", async () => {
    const url = await storage.createDownloadUrl({ key: "k.pdf", expiresInSeconds: 300 });
    expect(new URL(url).searchParams.get("response-content-disposition")).toMatch(/^attachment/);
  });

  test("download URL can ask the browser to show the file inline", async () => {
    const url = await storage.createDownloadUrl({ key: "k.pdf", expiresInSeconds: 300, disposition: "inline" });
    expect(new URL(url).searchParams.get("response-content-disposition")).toMatch(/^inline/);
  });

  test("download file name with quotes and non-English letters cannot break out of the header", async () => {
    const url = await storage.createDownloadUrl({
      key: "k.pdf",
      expiresInSeconds: 300,
      downloadName: 'Notes "Unit 1"\r\nX-Evil: 1 – प्रश्न.pdf',
    });
    const disposition = new URL(url).searchParams.get("response-content-disposition") ?? "";
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toContain('"Unit 1"');
  });

  test("head returns null when the vendor says the object does not exist", async () => {
    const missing = createS3FileStorage(config, {
      send: async () => {
        throw Object.assign(new Error("nope"), { name: "NotFound" });
      },
    });
    expect(await missing.head("gone")).toBeNull();
  });

  test("get returns null when the vendor says the key does not exist", async () => {
    const missing = createS3FileStorage(config, {
      send: async () => {
        throw Object.assign(new Error("nope"), { name: "NoSuchKey" });
      },
    });
    expect(await missing.get("gone")).toBeNull();
  });

  test("other vendor errors are not hidden", async () => {
    const broken = createS3FileStorage(config, {
      send: async () => {
        throw Object.assign(new Error("denied"), { name: "AccessDenied" });
      },
    });
    await expect(broken.head("k")).rejects.toThrow("denied");
  });
});
