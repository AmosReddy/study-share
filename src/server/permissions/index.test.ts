import { describe, expect, test } from "vitest";
import { can, type Action, type MemberStatus, type Role } from "./index";

const user = { id: "u1" };
const member = (status: MemberStatus, role: Role = "member") => ({ membership: { role, status } });

describe("can(group.view)", () => {
  test.each(["owner", "admin", "member"] as const)("active %s can view", (role) => {
    expect(can(user, "group.view", member("active", role))).toBe(true);
  });

  test("signed-out visitor is denied", () => {
    expect(can(null, "group.view", member("active"))).toBe(false);
  });

  test("non-member is denied", () => {
    expect(can(user, "group.view", { membership: null })).toBe(false);
  });

  test.each(["pending", "removed"] as const)("%s member is denied", (status) => {
    expect(can(user, "group.view", member(status))).toBe(false);
  });

  test("unknown action is denied", () => {
    expect(can(user, "group.nuke" as Action, member("active", "owner"))).toBe(false);
  });
});
