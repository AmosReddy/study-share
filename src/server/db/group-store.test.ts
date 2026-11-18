import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORM_CONFIG, type FormConfig } from "@/shared/form-config";
import { createGroupStore } from "./group-store";

/*
  No database here: a stand-in executor records the statements and answers with rows set up by the
  test. This checks the parts that need no Postgres (the shape of the one atomic statement, the
  order of the calls, the warning on a damaged form). The real behaviour (two saves at the same
  instant, the version check) runs against Postgres in group-store.int.test.ts.
*/
const GROUP = "11111111-1111-4111-8111-111111111111";
const dialect = new PgDialect();

type Call = { text: string; params: unknown[] };

function fakeDb(answers: unknown[][]) {
  const calls: Call[] = [];
  const db = {
    execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query);
      calls.push({ text: sql.replace(/\s+/g, " ").trim(), params });
      return answers.shift() ?? [];
    },
    transaction: async () => {
      throw new Error("no transaction expected");
    },
  };
  // The store only needs `execute` and `transaction`; the stand-in is typed loosely on purpose.
  return { store: createGroupStore(db as never), calls };
}

const CUSTOM: FormConfig = { version: 2, types: [{ id: "a1", label: "Lecture notes" }], fields: [] };

describe("SQL group store: updateFormConfig", () => {
  it("is one statement when it saves, with the version check inside it and the form as text cast to jsonb", async () => {
    const { store, calls } = fakeDb([[{ "?column?": 1 }]]);
    expect(await store.updateFormConfig(GROUP, 1, CUSTOM)).toBe("saved");
    expect(calls).toHaveLength(1);
    const [{ text, params }] = calls;
    expect(text).toMatch(/^update public\.groups set form_config = \$1::text::jsonb where /);
    expect(text).toContain("deleted_at is null");
    expect(text).toContain("returning 1");
    expect(text).toMatch(/form_config->'version'/);
    // The form travels as one text parameter (never spliced into the statement), then the group and the version.
    expect(params[0]).toBe(JSON.stringify(CUSTOM));
    expect(params).toContain(GROUP);
    expect(params).toContain(1);
    expect(text).not.toContain("Lecture notes");
  });

  it("reads again only when nothing was updated: a live group is stale, a missing one is gone", async () => {
    const stale = fakeDb([[], [{ "?column?": 1 }]]);
    expect(await stale.store.updateFormConfig(GROUP, 1, CUSTOM)).toBe("stale");
    expect(stale.calls).toHaveLength(2);
    expect(stale.calls[1].text).toMatch(/^select 1 from public\.groups where id = \$1::uuid and deleted_at is null/);

    const gone = fakeDb([[], []]);
    expect(await gone.store.updateFormConfig(GROUP, 1, CUSTOM)).toBe("group_gone");
    expect(gone.calls).toHaveLength(2);
  });

  it("does not touch the database for an id that is not a uuid", async () => {
    const { store, calls } = fakeDb([]);
    for (const bad of ["", "not-a-uuid", "12345"]) expect(await store.updateFormConfig(bad, 1, CUSTOM)).toBe("group_gone");
    expect(calls).toHaveLength(0);
  });

  it("does not try to update with a version that is not a positive whole number, it only looks the group up", async () => {
    for (const version of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 40]) {
      const live = fakeDb([[{ "?column?": 1 }]]);
      expect(await live.store.updateFormConfig(GROUP, version, CUSTOM), String(version)).toBe("stale");
      expect(live.calls).toHaveLength(1);
      expect(live.calls[0].text).toMatch(/^select 1 from public\.groups/);

      const gone = fakeDb([[]]);
      expect(await gone.store.updateFormConfig(GROUP, version, CUSTOM), String(version)).toBe("group_gone");
    }
  });

  it("lets a database error through, so the use-case can log it and say it could not save", async () => {
    const db = { execute: async () => Promise.reject(new Error("boom")), transaction: async () => undefined };
    await expect(createGroupStore(db as never).updateFormConfig(GROUP, 1, CUSTOM)).rejects.toThrow("boom");
  });
});

describe("SQL group store: reading a stored form", () => {
  const WARNING = "A group's stored upload form is not valid, so the default form is used.";
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const row = (formConfig: string) => ({
    id: GROUP,
    name: "G",
    description: "",
    join_mode: "link",
    password_hash: null,
    invite_token: "t",
    invite_code: "c",
    form_config: formConfig,
    created_ms: 1_700_000_000_000,
  });
  const read = async (formConfig: string) => {
    const { store } = fakeDb([[row(formConfig)]]);
    return (await store.findById(GROUP))?.formConfig;
  };

  it("reads a valid form as stored, without a warning", async () => {
    expect(await read(JSON.stringify(CUSTOM))).toEqual(CUSTOM);
    expect(await read(JSON.stringify(DEFAULT_FORM_CONFIG))).toEqual(DEFAULT_FORM_CONFIG);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a value that is JSON null reads as the default without a warning (nothing was stored)", async () => {
    expect(await read("null")).toEqual(DEFAULT_FORM_CONFIG);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs one fixed warning when a stored value that is not null is not a valid form, and falls back to the default", async () => {
    for (const damaged of ["{}", "[]", '"text"', "5", "true", '{"version":1,"types":"x","fields":[]}', "not json at all", ""]) {
      warn.mockClear();
      expect(await read(damaged), damaged).toEqual(DEFAULT_FORM_CONFIG);
      expect(warn, damaged).toHaveBeenCalledTimes(1);
      // A fixed sentence: nothing from the stored value or the group is in the log line.
      expect(warn).toHaveBeenCalledWith(WARNING);
    }
  });

  it("every read path warns the same way (findById and findByInvite)", async () => {
    const { store } = fakeDb([[row("{}")], [row("{}")]]);
    await store.findById(GROUP);
    await store.findByInvite({ token: "t" });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
