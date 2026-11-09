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
  addMember(
    groupId: string,
    userId: string,
  ): Promise<"joined" | "already_member" | "removed" | "full" | "too_many_groups" | "group_gone">;
  /** Deletes the membership row, so a person who left can join again. */
  leave(groupId: string, userId: string): Promise<"left" | "owner" | "not_member">;
  /** Sets the status to removed (which blocks a later join). False for the owner and for a non-member. */
  removeMember(groupId: string, userId: string): Promise<boolean>;
  /** Active members only, the owner first and then by joining time. */
  listMembers(groupId: string): Promise<MemberRow[]>;
  updateDetails(groupId: string, d: { name: string; description: string }): Promise<boolean>;
  updateJoin(groupId: string, j: { joinMode: JoinMode; passwordHash: string | null }): Promise<boolean>;
  replaceInvite(groupId: string, i: { inviteToken: string; inviteCode: string }): Promise<"ok" | "invite_taken" | "group_gone">;
}
