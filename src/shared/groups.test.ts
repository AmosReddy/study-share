import { describe, expect, it } from "vitest";
import {
  createGroupSchema,
  deleteGroupSchema,
  editGroupSchema,
  GROUP_CODE_ALPHABET,
  GROUP_LIMITS,
  isGroupCode,
  joinCodeSchema,
  joinGroupSchema,
  joinModeSchema,
  normalizeGroupCode,
  transferOwnershipSchema,
} from "./groups";
import { GROUP_MESSAGES } from "./group-messages";

const linkGroup = { name: "Data Structures", joinMode: "link" } as const;

describe("GROUP_LIMITS", () => {
  it("has the agreed values", () => {
    expect(GROUP_LIMITS).toEqual({
      maxGroupsPerPerson: 20,
      maxMembers: 300,
      nameMin: 2,
      nameMax: 60,
      descriptionMax: 300,
      passwordMin: 6,
      passwordMax: 64,
      codeLength: 8,
    });
  });
});

describe("group names", () => {
  it("trims and collapses inner spaces", () => {
    const result = createGroupSchema.parse({ ...linkGroup, name: "  Data   Structures " });
    expect(result.name).toBe("Data Structures");
  });

  it("accepts 60 code points and refuses 61", () => {
    expect(createGroupSchema.safeParse({ ...linkGroup, name: "😀".repeat(60) }).success).toBe(true);
    const tooLong = createGroupSchema.safeParse({ ...linkGroup, name: "😀".repeat(61) });
    expect(tooLong.success).toBe(false);
  });

  it("refuses a single character", () => {
    const result = createGroupSchema.safeParse({ ...linkGroup, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["name"]);
  });

  it("accepts Hindi and Telugu names", () => {
    expect(createGroupSchema.safeParse({ ...linkGroup, name: "गणित कक्षा" }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...linkGroup, name: "గణిత తరగతి" }).success).toBe(true);
  });

  it("applies the same name rule when editing", () => {
    expect(editGroupSchema.parse({ name: "  Maths  " })).toEqual({ name: "Maths", description: "" });
    expect(editGroupSchema.safeParse({ name: "A" }).success).toBe(false);
  });
});

describe("group descriptions", () => {
  it("defaults to an empty string and is trimmed", () => {
    expect(createGroupSchema.parse(linkGroup).description).toBe("");
    expect(createGroupSchema.parse({ ...linkGroup, description: "  hello  " }).description).toBe("hello");
  });

  it("accepts 300 characters and refuses 301", () => {
    expect(createGroupSchema.safeParse({ ...linkGroup, description: "a".repeat(300) }).success).toBe(true);
    const result = createGroupSchema.safeParse({ ...linkGroup, description: "a".repeat(301) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["description"]);
    expect(editGroupSchema.safeParse({ name: "Maths", description: "a".repeat(301) }).success).toBe(false);
  });
});

describe("join mode and password", () => {
  it("refuses a password-mode group with a short password", () => {
    const result = createGroupSchema.safeParse({ name: "Maths", joinMode: "password", password: "12345" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["password"]);
  });

  it("refuses a password-mode group with no password", () => {
    const result = createGroupSchema.safeParse({ name: "Maths", joinMode: "password" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["password"]);
  });

  it("refuses a 65-character password and accepts 6 and 64", () => {
    const base = { name: "Maths", joinMode: "password" } as const;
    expect(createGroupSchema.safeParse({ ...base, password: "a".repeat(65) }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...base, password: "a".repeat(64) }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...base, password: "123456" }).success).toBe(true);
  });

  it("keeps the password untrimmed", () => {
    const result = createGroupSchema.parse({ name: "Maths", joinMode: "password", password: " abc def " });
    expect(result.password).toBe(" abc def ");
  });

  it("link mode needs no password and drops one that was typed", () => {
    expect(createGroupSchema.parse(linkGroup).password).toBeUndefined();
    expect(createGroupSchema.parse({ ...linkGroup, password: "12" }).password).toBeUndefined();
  });

  it("joinModeSchema follows the same rule", () => {
    expect(joinModeSchema.safeParse({ joinMode: "password", password: "12345" }).success).toBe(false);
    expect(joinModeSchema.safeParse({ joinMode: "password" }).success).toBe(false);
    expect(joinModeSchema.parse({ joinMode: "password", password: "123456" })).toEqual({
      joinMode: "password",
      password: "123456",
    });
    expect(joinModeSchema.parse({ joinMode: "link" })).toEqual({ joinMode: "link", password: undefined });
    expect(joinModeSchema.safeParse({ joinMode: "other" }).success).toBe(false);
  });
});

describe("join group form", () => {
  it("takes a key and an optional password", () => {
    expect(joinGroupSchema.parse({ key: "abc" })).toEqual({ key: "abc" });
    expect(joinGroupSchema.parse({ key: "abc", password: "x y" })).toEqual({ key: "abc", password: "x y" });
    expect(joinGroupSchema.safeParse({ key: "" }).success).toBe(false);
  });

  it("refuses a key over 100 characters and a key with a NUL byte (Postgres cannot store one)", () => {
    expect(joinGroupSchema.safeParse({ key: "a".repeat(100) }).success).toBe(true);
    expect(joinGroupSchema.safeParse({ key: "a".repeat(101) }).success).toBe(false);
    expect(joinGroupSchema.safeParse({ key: "abc\u0000def" }).success).toBe(false);
    expect(joinGroupSchema.safeParse({ key: "\u0000" }).success).toBe(false);
  });
});

describe("NUL bytes in text fields", () => {
  it("are refused in a group name, on create and on edit", () => {
    expect(createGroupSchema.safeParse({ ...linkGroup, name: "Data\u0000 Structures" }).success).toBe(false);
    expect(editGroupSchema.safeParse({ name: "Data\u0000 Structures" }).success).toBe(false);
  });

  it("are refused in a description, on create and on edit", () => {
    expect(createGroupSchema.safeParse({ ...linkGroup, description: "notes\u0000" }).success).toBe(false);
    expect(editGroupSchema.safeParse({ name: "Maths", description: "notes\u0000" }).success).toBe(false);
  });

  it("report the field they are in", () => {
    const result = editGroupSchema.safeParse({ name: "Maths\u0000", description: "" });
    expect(!result.success && result.error.issues[0].path).toEqual(["name"]);
  });
});

describe("group codes", () => {
  it("has 31 characters and none that look alike", () => {
    expect(GROUP_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(GROUP_CODE_ALPHABET).size).toBe(31);
    for (const banned of ["0", "O", "1", "I", "L"]) {
      expect(GROUP_CODE_ALPHABET).not.toContain(banned);
    }
  });

  it("normalises spaces, hyphens and case", () => {
    expect(normalizeGroupCode(" ab-cd 234 ")).toBe("ABCD234");
  });

  it("also drops en dashes, em dashes, non-breaking hyphens, minus signs and no-break spaces", () => {
    expect(normalizeGroupCode("abcd‐efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd‑efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd‒efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd–efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd—efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd―efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd−efg2")).toBe("ABCDEFG2");
    expect(normalizeGroupCode("abcd efg2 ")).toBe("ABCDEFG2");
    expect(isGroupCode("abcd–efg2")).toBe(true);
  });

  it("recognises a valid code", () => {
    expect(isGroupCode("ABCDEFG2")).toBe(true);
    expect(isGroupCode("abcd-efg2")).toBe(true);
    expect(isGroupCode("ABCDEFG0")).toBe(false);
    expect(isGroupCode("ABCDEFGI")).toBe(false);
    expect(isGroupCode("ABCDEFG")).toBe(false);
    expect(isGroupCode("ABCDEFG22")).toBe(false);
  });

  it("joinCodeSchema normalises and validates", () => {
    expect(joinCodeSchema.parse({ code: " abcd-efg2 " })).toEqual({ code: "ABCDEFG2" });
    expect(joinCodeSchema.safeParse({ code: "ABCDEFG0" }).success).toBe(false);
    expect(joinCodeSchema.safeParse({ code: "" }).success).toBe(false);
  });
});

describe("transferOwnershipSchema and deleteGroupSchema", () => {
  const id = "3f0c7f0e-6b7a-4d6e-9d0f-5a1b2c3d4e5f";

  it("transferOwnershipSchema takes only a UUID string", () => {
    expect(transferOwnershipSchema.parse({ targetUserId: id })).toEqual({ targetUserId: id });
    for (const bad of [{}, { targetUserId: "" }, { targetUserId: "nope" }, { targetUserId: 7 }, { targetUserId: ` ${id}` }]) {
      expect(transferOwnershipSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("deleteGroupSchema trims, needs 1 to 100 characters and rejects a NUL", () => {
    expect(deleteGroupSchema.parse({ confirmName: "  Maths   club " })).toEqual({ confirmName: "Maths   club" });
    expect(deleteGroupSchema.safeParse({ confirmName: "   " }).success).toBe(false);
    expect(deleteGroupSchema.safeParse({}).success).toBe(false);
    expect(deleteGroupSchema.safeParse({ confirmName: "a".repeat(100) }).success).toBe(true);
    expect(deleteGroupSchema.safeParse({ confirmName: "a".repeat(101) }).success).toBe(false);
    expect(deleteGroupSchema.safeParse({ confirmName: "😀".repeat(100) }).success).toBe(true);
    expect(deleteGroupSchema.safeParse({ confirmName: "bad\u0000name" }).success).toBe(false);
  });
});

describe("GROUP_MESSAGES", () => {
  it("pins the fixed sentences", () => {
    expect(GROUP_MESSAGES.invalidInvite).toBe(
      "This invite link isn't valid any more. Ask the group owner for a new one.",
    );
    expect(GROUP_MESSAGES.codeNotFound).toBe(GROUP_MESSAGES.invalidInvite);
    expect(GROUP_MESSAGES.cannotJoin).toBe("You can't join this group.");
    expect(GROUP_MESSAGES.full).toBe("This group is full.");
    expect(GROUP_MESSAGES.wrongPassword).toBe("That password is not right.");
    expect(GROUP_MESSAGES.locked).toBe("Too many wrong passwords.");
    expect(GROUP_MESSAGES.tooManyGroups).toBe(
      "You are in 20 groups, the most one account can be in. Leave one to join another.",
    );
    expect(GROUP_MESSAGES.ownerCannotLeave).toBe(
      "You own this group. Hand it over to another member first, then you can leave.",
    );
    expect(GROUP_MESSAGES.transferTargetInvalid).toBe("Pick someone who is in this group.");
    expect(GROUP_MESSAGES.deleteNameMismatch).toBe("That is not the group's name. Type it exactly as shown.");
    expect(GROUP_MESSAGES.badForm).toBe("Check the form and try again.");
    for (const key of ["tooMany", "couldNotSave"] as const) {
      expect(GROUP_MESSAGES[key].length).toBeGreaterThan(0);
    }
  });
});
