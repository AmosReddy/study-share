import { describe, expect, it } from "vitest";
import { FILE_MESSAGES } from "./file-messages";
import { prepareUploadSchema } from "./resource-schemas";
import { ALLOWED_FILE_TYPES, RESOURCE_LIMITS, classifyUpload, safeFileName } from "./resources";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const POWERPOINT = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("ALLOWED_FILE_TYPES", () => {
  it("lists exactly the kinds the app takes, and no scriptable or executable kind", () => {
    expect(Object.keys(ALLOWED_FILE_TYPES).sort()).toEqual(
      ["csv", "doc", "docx", "gif", "jpeg", "jpg", "pdf", "png", "ppt", "pptx", "txt", "webp", "xls", "xlsx"],
    );
    for (const bad of ["svg", "html", "htm", "xml", "js", "zip", "exe", "bat", "sh", "jar", "php", "docm", "xlsm"]) {
      expect(Object.keys(ALLOWED_FILE_TYPES)).not.toContain(bad);
    }
    const everyType = Object.values(ALLOWED_FILE_TYPES).flatMap((entry) => entry.types as readonly string[]);
    for (const type of everyType) expect(type).not.toMatch(/html|svg|\+xml|^text\/xml|javascript|zip|octet/);
  });
});

describe("classifyUpload", () => {
  it.each([
    ["notes.pdf", "application/pdf", "application/pdf", true],
    ["a.doc", "application/msword", "application/msword", false],
    ["a.docx", WORD, WORD, false],
    ["a.ppt", "application/vnd.ms-powerpoint", "application/vnd.ms-powerpoint", false],
    ["a.pptx", POWERPOINT, POWERPOINT, false],
    ["a.xls", "application/vnd.ms-excel", "application/vnd.ms-excel", false],
    ["a.xlsx", EXCEL, EXCEL, false],
    ["a.txt", "text/plain", "text/plain", false],
    ["a.csv", "text/csv", "text/csv", false],
    ["a.png", "image/png", "image/png", true],
    ["a.jpg", "image/jpeg", "image/jpeg", true],
    ["a.jpeg", "image/jpeg", "image/jpeg", true],
    ["a.gif", "image/gif", "image/gif", true],
    ["a.webp", "image/webp", "image/webp", true],
  ])("%s with %s is accepted as %s (previewable: %s)", (name, declared, canonical, previewable) => {
    expect(classifyUpload(name, declared)).toMatchObject({ ok: true, contentType: canonical, previewable });
  });

  it("decides by the extension, in any letter case, and the last extension wins", () => {
    expect(classifyUpload("NOTES.PDF", "application/pdf")).toMatchObject({ ok: true, extension: "pdf", category: "pdf" });
    expect(classifyUpload("a.tar.pdf", "application/pdf").ok).toBe(true);
    expect(classifyUpload("a.pdf.exe", "application/pdf").ok).toBe(false);
    expect(classifyUpload("a.pdf ", "application/pdf").ok).toBe(true);
  });

  it("accepts the other types browsers send for a kind, and answers with the canonical one", () => {
    expect(classifyUpload("data.csv", "application/vnd.ms-excel")).toMatchObject({ ok: true, contentType: "text/csv" });
    expect(classifyUpload("data.csv", "text/csv; charset=utf-8")).toMatchObject({ ok: true, contentType: "text/csv" });
    expect(classifyUpload("a.jpg", "IMAGE/PJPEG")).toMatchObject({ ok: true, contentType: "image/jpeg" });
  });

  it("accepts an empty or application/octet-stream type only for a known extension, with the canonical type", () => {
    for (const declared of ["", "application/octet-stream"]) {
      expect(classifyUpload("slides.pptx", declared)).toMatchObject({ ok: true, contentType: POWERPOINT });
      expect(classifyUpload("data.csv", declared)).toMatchObject({ ok: true, contentType: "text/csv" });
      expect(classifyUpload("a.exe", declared).ok).toBe(false);
      expect(classifyUpload("a.svg", declared).ok).toBe(false);
      expect(classifyUpload("noextension", declared).ok).toBe(false);
    }
  });

  it("refuses a declared type that does not belong to the extension", () => {
    expect(classifyUpload("a.pdf", "text/html").ok).toBe(false);
    expect(classifyUpload("a.png", "application/pdf").ok).toBe(false);
    expect(classifyUpload("a.txt", "text/html").ok).toBe(false);
    expect(classifyUpload("a.docx", "application/msword").ok).toBe(false);
  });

  it("refuses unknown, dangerous and inherited-property extensions", () => {
    const names = ["a.svg", "a.html", "a.zip", "a.exe", "a.js", "a", "a.", ".", "", "a.constructor", "a.__proto__", "a.toString"];
    for (const name of names) expect(classifyUpload(name, "").ok).toBe(false);
  });
});

describe("safeFileName", () => {
  it.each([
    ["notes.pdf", "notes.pdf"],
    ["Unit 1 notes.PDF", "Unit 1 notes.pdf"],
    ["C:\\Users\\me\\notes.pdf", "notes.pdf"],
    ["/etc/passwd.txt", "passwd.txt"],
    ["../../secret.pdf", "secret.pdf"],
    ["a/b\\c.png", "c.png"],
    ["bad:name?.pdf", "bad_name_.pdf"],
    ["a\u0000b\u0007c.pdf", "abc.pdf"],
    ["evil\u202egnp.exe", "evilgnp.exe"],
    ["tab\there\nnewline.pdf", "tab here newline.pdf"],
    ["प्रश्न पत्र.pdf", "प्रश्न पत्र.pdf"],
    ["résumé.docx", "résumé.docx"],
    ["  spaced  .pdf", "spaced.pdf"],
    ["50% off #1.txt", "50_ off _1.txt"],
  ])("%j becomes %j", (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it("never returns an empty name, a dot name or a path", () => {
    for (const input of ["", " ", ".", "..", "...", "/", "\\", ".pdf", "  .PDF", "\u0000", "///.."]) {
      const name = safeFileName(input);
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toMatch(/^\.+$/);
      expect(name).not.toMatch(/[\\/]/);
    }
    expect(safeFileName("")).toBe("file");
    expect(safeFileName(".pdf")).toBe("file.pdf");
    expect(safeFileName("..")).toBe("file");
  });

  it("limits the name to the file name limit in characters, keeping the extension", () => {
    const name = safeFileName(`${"a".repeat(500)}.pdf`);
    expect([...name]).toHaveLength(RESOURCE_LIMITS.maxFileName);
    expect(name.endsWith(".pdf")).toBe(true);
    const emoji = safeFileName(`${"😀".repeat(500)}.docx`);
    expect([...emoji]).toHaveLength(RESOURCE_LIMITS.maxFileName);
    expect(emoji.endsWith(".docx")).toBe(true);
    expect(emoji).not.toContain("\uFFFD");
  });

  it("keeps a lone surrogate from breaking later encoding", () => {
    expect(() => encodeURIComponent(safeFileName("bad\uD800name.pdf"))).not.toThrow();
  });
});

describe("prepareUploadSchema", () => {
  const good = { title: " Notes ", subject: "", type: "notes", fileName: "a b.PDF", contentType: "", sizeBytes: 10 };

  it("cleans the name, tidies the text and replaces the type with the canonical one", () => {
    const result = prepareUploadSchema.safeParse(good);
    expect(result.success && result.data).toMatchObject({ title: "Notes", fileName: "a b.pdf", contentType: "application/pdf" });
  });

  it("reports the file kind on fileName, with the friendly message", () => {
    const result = prepareUploadSchema.safeParse({ ...good, fileName: "a.svg" });
    expect(!result.success && result.error.issues.map((i) => [i.path, i.message])).toEqual([
      [["fileName"], FILE_MESSAGES.fileTypeNotAllowed],
    ]);
  });
});
