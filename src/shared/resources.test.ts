import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_FORM_CONFIG, typeLabel } from "./form-config";
import { RESOURCE_LIMITS } from "./resources";

const migration = readFileSync(join(process.cwd(), "drizzle", "0005_resources.sql"), "utf8");

describe("resource constants", () => {
  it("name the types people see (the labels live in the default form now)", () => {
    const labels = [...DEFAULT_FORM_CONFIG.types.map((type) => type.label), typeLabel(DEFAULT_FORM_CONFIG, "other", "")];
    expect(labels).toEqual(["Notes", "Previous year paper", "Study material", "Assignment", "Other"]);
    expect(RESOURCE_LIMITS.maxFileBytes).toBe(25 * 1024 * 1024);
  });

  it("match the checks in the migration, so the database and the app cannot drift apart", () => {
    // The old type check (dropped again by 0007) listed the keys the default form still uses as its ids.
    const typeList = [...DEFAULT_FORM_CONFIG.types.map((type) => type.id), "other"].map((t) => `'${t}'`).join(", ");
    expect(migration).toContain(`CHECK (type in (${typeList}))`);
    expect(migration).toContain(`char_length(btrim(title)) between 1 and ${RESOURCE_LIMITS.maxTitle}`);
    expect(migration).toContain(`char_length(subject) <= ${RESOURCE_LIMITS.maxSubject}`);
    expect(migration).toContain(`char_length(file_name) between 1 and ${RESOURCE_LIMITS.maxFileName}`);
  });

  it("enable Row Level Security on the table", () => {
    expect(migration).toContain('ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY');
  });
});
