import { describe, expect, it } from "vitest";
import { isTabActive } from "./active-tab";

const BASE = "/groups/abc";

describe("isTabActive", () => {
  it("keeps Library lit on its own page, the upload page and every file page", () => {
    for (const path of [BASE, `${BASE}/`, `${BASE}/upload`, `${BASE}/files/f1`, `${BASE}/files/f1/edit`]) {
      expect(isTabActive(path, BASE, "library"), path).toBe(true);
      expect(isTabActive(path, BASE, "members"), path).toBe(false);
      expect(isTabActive(path, BASE, "settings"), path).toBe(false);
    }
  });

  it("lights Members and Settings on their own address only", () => {
    expect(isTabActive(`${BASE}/members`, BASE, "members")).toBe(true);
    expect(isTabActive(`${BASE}/members`, BASE, "library")).toBe(false);
    expect(isTabActive(`${BASE}/settings`, BASE, "settings")).toBe(true);
    expect(isTabActive(`${BASE}/settings`, BASE, "library")).toBe(false);
  });

  it("does not light Library for another group or for look-alike addresses", () => {
    expect(isTabActive("/groups/abcd", BASE, "library")).toBe(false);
    expect(isTabActive(`${BASE}/uploads`, BASE, "library")).toBe(false);
    expect(isTabActive(`${BASE}/filesystem`, BASE, "library")).toBe(false);
    expect(isTabActive("/", BASE, "library")).toBe(false);
  });
});
