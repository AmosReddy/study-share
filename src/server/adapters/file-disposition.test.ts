import { describe, expect, test } from "vitest";
import { ALLOWED_FILE_TYPES, PREVIEWABLE_TYPES } from "@/shared/resources";
import { INLINE_SAFE_TYPES, contentDisposition, safeInlineType } from "./file-disposition";

describe("file-disposition", () => {
  test("the app's previewable types are exactly the types a browser may show inline", () => {
    expect([...INLINE_SAFE_TYPES].sort()).toEqual([...PREVIEWABLE_TYPES].sort());
  });

  test("no canonical type the app accepts is inline unless the app says it is previewable", () => {
    for (const { types } of Object.values(ALLOWED_FILE_TYPES)) {
      expect(safeInlineType(types[0]) !== undefined).toBe(PREVIEWABLE_TYPES.includes(types[0]));
    }
  });

  test("safeInlineType normalises and refuses everything else", () => {
    expect(safeInlineType("Application/PDF; charset=x")).toBe("application/pdf");
    expect(safeInlineType("image/svg+xml")).toBeUndefined();
    expect(safeInlineType(undefined)).toBeUndefined();
  });

  test("contentDisposition keeps to one line", () => {
    expect(contentDisposition("attachment", "a\r\nb.pdf")).not.toMatch(/[\r\n]/);
    expect(contentDisposition("inline")).toBe("inline");
  });
});
