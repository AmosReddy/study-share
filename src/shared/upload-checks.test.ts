import { describe, expect, it } from "vitest";
import { FILE_MESSAGES } from "./file-messages";
import { RESOURCE_LIMITS } from "./resources";
import { UPLOAD_ACCEPT, checkChosenFile, titleFromFileName, uploadContentType } from "./upload-checks";

describe("checkChosenFile", () => {
  it("accepts the kinds of file we take, in any letter case", () => {
    expect(checkChosenFile({ name: "notes.pdf", size: 1000 })).toBeNull();
    expect(checkChosenFile({ name: "Photo.JPG", size: 1000 })).toBeNull();
    expect(checkChosenFile({ name: "data.csv", size: RESOURCE_LIMITS.maxFileBytes })).toBeNull();
  });

  it("refuses kinds we do not take and files with no extension", () => {
    for (const name of ["virus.exe", "page.html", "logo.svg", "archive.zip", "README", "notes.pdf.exe"]) {
      expect(checkChosenFile({ name, size: 10 }), name).toBe(FILE_MESSAGES.fileTypeNotAllowed);
    }
  });

  it("refuses an empty file and one over the limit", () => {
    expect(checkChosenFile({ name: "a.pdf", size: 0 })).toBe(FILE_MESSAGES.fileEmpty);
    expect(checkChosenFile({ name: "a.pdf", size: RESOURCE_LIMITS.maxFileBytes + 1 })).toBe(FILE_MESSAGES.fileTooBig);
  });

  it("says the kind first when a file is both the wrong kind and too big", () => {
    expect(checkChosenFile({ name: "a.exe", size: RESOURCE_LIMITS.maxFileBytes + 1 })).toBe(FILE_MESSAGES.fileTypeNotAllowed);
  });
});

describe("uploadContentType", () => {
  it("is the canonical type for the extension", () => {
    expect(uploadContentType("a.pdf")).toBe("application/pdf");
    expect(uploadContentType("a.JPG")).toBe("image/jpeg");
    expect(uploadContentType("a.csv")).toBe("text/csv");
    expect(uploadContentType("a.docx")).toContain("wordprocessingml");
  });

  it("is empty for a kind we do not take", () => {
    expect(uploadContentType("a.exe")).toBe("");
  });
});

describe("titleFromFileName", () => {
  it("drops the extension and keeps the rest", () => {
    expect(titleFromFileName("Unit 1 notes.pdf")).toBe("Unit 1 notes");
    expect(titleFromFileName("my.notes.v2.docx")).toBe("my.notes.v2");
    expect(titleFromFileName("scan.PNG")).toBe("scan");
  });

  it("tidies spaces and never exceeds the title limit", () => {
    expect(titleFromFileName("  spaced   out .txt")).toBe("spaced out");
    expect([...titleFromFileName(`${"x".repeat(300)}.pdf`)]).toHaveLength(RESOURCE_LIMITS.maxTitle);
  });
});

describe("UPLOAD_ACCEPT", () => {
  it("lists dotted extensions only", () => {
    const parts = UPLOAD_ACCEPT.split(",");
    expect(parts).toContain(".pdf");
    expect(parts).toContain(".webp");
    expect(parts.every((part) => /^\.[a-z0-9]+$/.test(part))).toBe(true);
    expect(parts).not.toContain(".svg");
  });
});
