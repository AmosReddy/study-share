import { describe, expect, it } from "vitest";
import { contentMatchesType } from "./sniff";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const u8 = (...parts: number[][]) => new Uint8Array(parts.flat());

describe("contentMatchesType", () => {
  it("knows each signature, and refuses an empty sample", () => {
    expect(contentMatchesType("application/pdf", u8(ascii("%PDF-1.4")))).toBe(true);
    expect(contentMatchesType("application/pdf", u8(ascii("%PDF")))).toBe(false);
    expect(contentMatchesType("image/gif", u8(ascii("GIF87a")))).toBe(true);
    expect(contentMatchesType("image/gif", u8(ascii("GIF89a")))).toBe(true);
    expect(contentMatchesType("image/gif", u8(ascii("GIF90a")))).toBe(false);
    expect(contentMatchesType("image/webp", u8(ascii("RIFF"), [0, 0, 0, 0], ascii("WEBP")))).toBe(true);
    expect(contentMatchesType("image/webp", u8(ascii("RIFF"), [0, 0, 0, 0], ascii("AVI ")))).toBe(false);
    expect(contentMatchesType("image/jpeg", u8([0xff, 0xd8, 0xff]))).toBe(true);
    expect(contentMatchesType("image/jpeg", u8([0xff, 0xd8]))).toBe(false);
    for (const type of ["application/pdf", "image/png", "text/plain", "application/msword"]) {
      expect(contentMatchesType(type, new Uint8Array())).toBe(false);
    }
  });

  it("an Office type needs ZIP (new formats) or OLE (old formats), not the other", () => {
    const zip = u8([0x50, 0x4b, 0x03, 0x04]);
    const ole = u8([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(contentMatchesType(docx, zip)).toBe(true);
    expect(contentMatchesType(docx, ole)).toBe(false);
    expect(contentMatchesType("application/msword", ole)).toBe(true);
    expect(contentMatchesType("application/msword", zip)).toBe(false);
  });

  it("text and CSV pass without a NUL byte and fail with one anywhere in the sample", () => {
    expect(contentMatchesType("text/plain", u8(ascii("hello, नमस्ते")))).toBe(true);
    expect(contentMatchesType("text/csv", u8(ascii("a,b\n1,2\n"), [0]))).toBe(false);
  });

  it("a type it does not know never matches", () => {
    expect(contentMatchesType("text/html", u8(ascii("<html>")))).toBe(false);
    expect(contentMatchesType("image/svg+xml", u8(ascii("<svg>")))).toBe(false);
  });
});
