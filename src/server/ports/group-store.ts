import type { GroupRole, JoinMode, MemberStatus } from "@/shared/groups";

export type GroupRecord = {
  id: string;
  name: string;
  description: string;
  joinMode: JoinMode;
  passwordHash: string | null;
  inviteToken: string;
  inviteCode: string;
  createdAt: Date;
};

export type Membership = { role: GroupRole; status: MemberStatus };
export type GroupSummary = { id: string; name: string };
export type MemberRow = { userId: string; displayName: string; role: GroupRole; joinedAt: Date };

/**
 * The app's groups and who is in them. Every method that checks a limit (members per group,
 * groups per person) checks and writes as one step, so two requests at the same instant cannot
 * both take the last seat.
 */
export interface GroupStore {
  /** Makes the group and its owner membership. Fails when the owner is in 20 groups already, or an invite key is taken. */
  createGroup(input: {
    ownerId: string;
    name: string;
    description: string;
    joinMode: JoinMode;
    passwordHash: string | null;
    inviteToken: string;
    inviteCode: string;
  }): Promise<{ ok: true; group: GroupRecord } | { ok: false; reason: "too_many_groups" | "invite_taken" }>;
  /** Never returns a deleted group. */
  findByInvite(key: { token: string } | { code: string }): Promise<GroupRecord | null>;
  findById(id: string): Promise<GroupRecord | null>;
  getMembership(groupId: string, userId: string): Promise<Membership | null>;
  /** Active memberships in groups that are not deleted, ordered by name then id. */
  listGroupsFor(userId: string): Promise<GroupSummary[]>;
  /**
   * Adds the person as an active member. The first answer that applies, in this order:
   * "group_gone" (no such group, or it is deleted); "removed" (they were removed, which a join
   * never clears) or "already_member" (they are active already); "full" (the group has
   * GROUP_LIMITS.maxMembers active members); "too_many_groups" (they are active in
   * GROUP_LIMITS.maxGroupsPerPerson groups that are not deleted); otherwise "joined".
   */
  addMember(
    groupId: string,
    userId: string,
  ): Promise<"joined" | "already_member" | "removed" | "full" | "too_many_groups" | "group_gone">;
  /**
   * Deletes the membership row, so a person who left can join again. "owner" for the owner (the
   * row stays). "not_member" when there is no row, and also for a removed person, whose row is
   * kept as it is: leaving never clears a removal.
   */
  leave(groupId: string, userId: string): Promise<"left" | "owner" | "not_member">;
  /** Sets the status to removed (which blocks a later join). False for the owner and for a non-member. */
  removeMember(groupId: string, userId: string): Promise<boolean>;
  /** Active members only, the owner first and then by joining time. */
  listMembers(groupId: string): Promise<MemberRow[]>;
  updateDetails(groupId: string, d: { name: string; description: string }): Promise<boolean>;
  updateJoin(groupId: string, j: { joinMode: JoinMode; passwordHash: string | null }): Promise<boolean>;
  replaceInvite(groupId: string, i: { inviteToken: string; inviteCode: string }): Promise<"ok" | "invite_taken" | "group_gone">;
}
