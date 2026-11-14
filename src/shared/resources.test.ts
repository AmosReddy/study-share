import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESOURCE_LIMITS, RESOURCE_TYPES, RESOURCE_TYPE_VALUES } from "./resources";

const migration = readFileSync(join(process.cwd(), "drizzle", "0005_resources.sql"), "utf8");

describe("resource constants", () => {
  it("name the types people see", () => {
    expect(RESOURCE_TYPE_VALUES).toEqual(["notes", "pyq", "study_material", "assignment", "other"]);
    expect(Object.values(RESOURCE_TYPES)).toEqual(["Notes", "Previous year paper", "Study material", "Assignment", "Other"]);
    expect(RESOURCE_LIMITS.maxFileBytes).toBe(25 * 1024 * 1024);
  });

  it("match the checks in the migration, so the database and the app cannot drift apart", () => {
    const typeList = RESOURCE_TYPE_VALUES.map((t) => `'${t}'`).join(", ");
    expect(migration).toContain(`CHECK (type in (${typeList}))`);
    expect(migration).toContain(`char_length(btrim(title)) between 1 and ${RESOURCE_LIMITS.maxTitle}`);
    expect(migration).toContain(`char_length(subject) <= ${RESOURCE_LIMITS.maxSubject}`);
    expect(migration).toContain(`char_length(file_name) between 1 and ${RESOURCE_LIMITS.maxFileName}`);
  });

  it("enable Row Level Security on the table", () => {
    expect(migration).toContain('ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY');
  });
});
