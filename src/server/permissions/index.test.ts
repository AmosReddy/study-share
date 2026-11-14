import { describe, expect, test } from "vitest";
import type { GroupRole as SharedGroupRole, MemberStatus as SharedMemberStatus } from "@/shared/groups";
import { can, type Action, type MemberStatus, type Role } from "./index";

const user = { id: "u1" };
const member = (status: MemberStatus, role: Role = "member") => ({ membership: { role, status } });

const everyRole = ["owner", "admin", "member"] as const satisfies readonly Role[];

/** Each action and exactly the roles that may do it. */
const groupActions = {
  "group.view": ["owner", "admin", "member"],
  "group.members.view": ["owner", "admin", "member"],
  "group.leave": ["member"],
  "group.edit": ["owner"],
  "group.join.change": ["owner"],
  "group.invite.view": ["owner"],
  "group.invite.reset": ["owner"],
  "group.members.remove": ["owner"],
  "group.transfer": ["owner"],
  "group.delete": ["owner"],
  "file.upload": ["owner", "member"],
  "file.view": ["owner", "member"],
  "file.delete.any": ["owner"],
  "chat.view": ["owner", "member"],
  "chat.send": ["owner", "member"],
  "message.delete.any": ["owner"],
} as const satisfies Record<Action, readonly Role[]>;

describe("can(group and file actions)", () => {
  describe.each(Object.keys(groupActions) as Action[])("%s", (action) => {
    const allowed: readonly Role[] = groupActions[action];

    test.each(everyRole)("active %s is decided by the role list", (role) => {
      expect(can(user, action, member("active", role))).toBe(allowed.includes(role));
    });

    test("signed-out visitor is denied", () => {
      expect(can(null, action, member("active", "owner"))).toBe(false);
    });

    test("non-member is denied", () => {
      expect(can(user, action, { membership: null })).toBe(false);
    });

    test.each(["pending", "removed"] as const)("%s member is denied for every role", (status) => {
      for (const role of everyRole) {
        expect(can(user, action, member(status, role))).toBe(false);
      }
    });
  });

  test("the owner cannot leave their own group", () => {
    expect(can(user, "group.leave", member("active", "owner"))).toBe(false);
  });

  test("the table above lists every action the module knows", () => {
    // If an action is added to permissions without a row here, this line stops compiling.
    const listed: Record<Action, readonly Role[]> = groupActions;
    expect(Object.keys(listed)).toHaveLength(16);
  });

  test("an admin cannot upload or view files, since the role table does not list it (no admin exists yet)", () => {
    expect(can(user, "file.upload", member("active", "admin"))).toBe(false);
    expect(can(user, "file.view", member("active", "admin"))).toBe(false);
  });

  test("there is no action for editing a file: that is the uploader's right, decided by the use-case", () => {
    expect(can(user, "file.edit.own" as Action, member("active", "owner"))).toBe(false);
    expect(can(user, "file.delete.own" as Action, member("active", "member"))).toBe(false);
  });

  test("an admin cannot read or write the chat, since the role table does not list it (no admin exists yet)", () => {
    expect(can(user, "chat.view", member("active", "admin"))).toBe(false);
    expect(can(user, "chat.send", member("active", "admin"))).toBe(false);
    expect(can(user, "message.delete.any", member("active", "admin"))).toBe(false);
  });

  test("only the owner may delete other people's messages, and there is no action for your own or for editing", () => {
    expect(can(user, "message.delete.any", member("active", "owner"))).toBe(true);
    expect(can(user, "message.delete.any", member("active", "member"))).toBe(false);
    expect(can(user, "message.delete.own" as Action, member("active", "member"))).toBe(false);
    expect(can(user, "message.edit" as Action, member("active", "owner"))).toBe(false);
  });

  test("unknown action is denied", () => {
    expect(can(user, "group.nuke" as Action, member("active", "owner"))).toBe(false);
  });

  test("inherited object keys are not actions", () => {
    expect(can(user, "toString" as Action, member("active", "owner"))).toBe(false);
    expect(can(user, "__proto__" as Action, member("active", "owner"))).toBe(false);
  });
});

describe("shared group types", () => {
  type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

  test("GroupRole and MemberStatus in src/shared/groups.ts match the ones in permissions", () => {
    // `true` only type-checks while the two declarations are identical, so `npm run typecheck`
    // fails if either one drifts.
    const sameRole: Equal<SharedGroupRole, Role> = true;
    const sameStatus: Equal<SharedMemberStatus, MemberStatus> = true;
    expect(sameRole && sameStatus).toBe(true);
  });
});
