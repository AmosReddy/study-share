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
    expect(decodeURIComponent(new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "")).toContain("content-length");
    // No checksum of an empty body in the link: it would make a real (non-empty) upload fail.
    expect(url).not.toMatch(/x-amz-checksum|x-amz-sdk-checksum-algorithm/i);
  });

  test("download URL forces a download by default", async () => {
    const url = await storage.createDownloadUrl({ key: "k.pdf", expiresInSeconds: 300 });
    expect(new URL(url).searchParams.get("response-content-disposition")).toMatch(/^attachment/);
  });

  describe("showing a file inline in the browser (preview)", () => {
    const params = async (contentType: string) => {
      const url = await storage.createDownloadUrl({ key: "k", expiresInSeconds: 300, preview: { contentType } });
      return new URL(url).searchParams;
    };

    test.each(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"])(
      "%s may be shown inline, and the browser is told exactly that type",
      async (type) => {
        const search = await params(type);
        expect(search.get("response-content-disposition")).toMatch(/^inline/);
        expect(search.get("response-content-type")).toBe(type);
      },
    );

    test("the type is matched ignoring case and parameters, and re-sent without them", async () => {
      const search = await params("Application/PDF; charset=binary");
      expect(search.get("response-content-disposition")).toMatch(/^inline/);
      expect(search.get("response-content-type")).toBe("application/pdf");
    });

    // These would run script or show attacker-controlled pages from the storage address.
    test.each([
      "text/html",
      "text/html; charset=utf-8",
      "image/svg+xml",
      "application/xhtml+xml",
      "text/javascript",
      "application/javascript",
      "text/xml",
      "application/octet-stream",
      "image/png/../html",
      "",
    ])("%j is never shown inline: it becomes a download", async (type) => {
      const search = await params(type);
      expect(search.get("response-content-disposition")).toMatch(/^attachment/);
      expect(search.get("response-content-type")).toBeNull();
    });
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

  describe("download file names", () => {
    const dispositionFor = async (downloadName: string) => {
      const url = await storage.createDownloadUrl({ key: "k.pdf", expiresInSeconds: 300, downloadName });
      return new URL(url).searchParams.get("response-content-disposition") ?? "";
    };

    test("a name with a comma is quoted, so browsers do not reject the download", async () => {
      expect(await dispositionFor("DBMS,PYQ.pdf")).toContain('filename="DBMS,PYQ.pdf"');
    });

    test("a plain name is quoted too", async () => {
      expect(await dispositionFor("notes.pdf")).toContain('filename="notes.pdf"');
    });

    test("a name with a lone surrogate character does not crash the download", async () => {
      const disposition = await dispositionFor("bad\uD800name.pdf");
      expect(disposition).toMatch(/^attachment; filename="/);
      expect(disposition).toContain("filename*=UTF-8''");
    });

    test.each(["", "   ", "\r\n"])("an empty name %j gives a plain attachment, with no empty file name", async (name) => {
      expect(await dispositionFor(name)).toBe("attachment");
    });

    test("a name in another script keeps its real letters in filename*", async () => {
      const disposition = await dispositionFor("प्रश्न.pdf");
      expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("प्रश्न.pdf")}`);
    });
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

  describe("get", () => {
    const stored = (bytes: number[]) => ({ transformToByteArray: async () => new Uint8Array(bytes) });

    test("without a range asks for the whole file", async () => {
      const sent: { input: Record<string, unknown> }[] = [];
      const storage = createS3FileStorage(config, {
        send: async (command) => {
          sent.push(command as never);
          return { Body: stored([1, 2, 3]) };
        },
      });
      expect(await storage.get("k")).toEqual(new Uint8Array([1, 2, 3]));
      expect(sent[0].input).toEqual({ Bucket: "test-bucket", Key: "k" });
    });

    test("with a range sends an inclusive Range header and returns only those bytes", async () => {
      const sent: { input: Record<string, unknown> }[] = [];
      const storage = createS3FileStorage(config, {
        send: async (command) => {
          sent.push(command as never);
          return { Body: stored([37, 80]) };
        },
      });
      expect(await storage.get("k", { range: { start: 0, endInclusive: 4095 } })).toEqual(new Uint8Array([37, 80]));
      expect(sent[0].input).toEqual({ Bucket: "test-bucket", Key: "k", Range: "bytes=0-4095" });
    });
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
