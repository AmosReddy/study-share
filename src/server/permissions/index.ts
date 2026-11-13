import "server-only";

export type Role = "owner" | "admin" | "member";
export type MemberStatus = "active" | "pending" | "removed";

/** Later phases add actions here. Each action lists the roles allowed to do it. */
const allowedRoles = {
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
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof allowedRoles;
export type Actor = { id: string } | null;
export type GroupContext = {
  membership: { role: Role; status: MemberStatus } | null;
};

/**
 * The one place that decides who may do what. Deny by default: only an
 * active member whose role is listed for the action is allowed.
 */
export function can(user: Actor, action: Action, group: GroupContext): boolean {
  if (!user || !group.membership) return false;
  if (group.membership.status !== "active") return false;
  const roles: readonly Role[] | undefined = Object.hasOwn(allowedRoles, action)
    ? allowedRoles[action]
    : undefined;
  return roles?.includes(group.membership.role) ?? false;
}
