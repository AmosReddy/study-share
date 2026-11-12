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
   * kept as it is (leaving never clears a removal), and for a deleted group. Takes the group's
   * lock, so it cannot interleave with a join, a removal or a hand-over of the same group.
   */
  leave(groupId: string, userId: string): Promise<"left" | "owner" | "not_member">;
  /**
   * Sets the status to removed (which blocks a later join). False for the owner, for a non-member
   * and for a deleted group; removing an already removed person is true again. Takes the group's
   * lock, so a removal can never interleave with a join, a leave or a hand-over of the same group.
   */
  removeMember(groupId: string, userId: string): Promise<boolean>;
  /**
   * Hands the group over: `fromUserId` becomes a plain member and `toUserId` the owner, as one
   * step, so the group has exactly one active owner at every moment, also when two hand-overs of
   * the same group run at the same instant (the second finds "not_owner"). The first answer that
   * applies: "group_gone" (no such group, or it is deleted); "not_owner" (`fromUserId` is not the
   * group's active owner); "same_person" (from and to are the same); "not_member" (`toUserId` is
   * not an ACTIVE member: removed, left or never joined); otherwise "ok".
   */
  transferOwnership(
    groupId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<"ok" | "not_owner" | "not_member" | "same_person" | "group_gone">;
  /**
   * Marks the group deleted (a soft delete: every read then ignores it, and its invite link and
   * code stop working). Rows, memberships and invite keys are kept, and the keys stay unique
   * across deleted groups. False for an unknown group and for one that is deleted already.
   */
  softDeleteGroup(groupId: string): Promise<boolean>;
  /** Active members only, the owner first and then by joining time. */
  listMembers(groupId: string): Promise<MemberRow[]>;
  updateDetails(groupId: string, d: { name: string; description: string }): Promise<boolean>;
  updateJoin(groupId: string, j: { joinMode: JoinMode; passwordHash: string | null }): Promise<boolean>;
  replaceInvite(groupId: string, i: { inviteToken: string; inviteCode: string }): Promise<"ok" | "invite_taken" | "group_gone">;
}
