import { GROUP_LIMITS, type GroupRole, type MemberStatus } from "@/shared/groups";
import type { GroupRecord, GroupStore, MemberRow } from "../ports/group-store";
import { getFakeAuthStore, type FakeAuthStore } from "./fake-auth-provider";

/*
  Test-mode GroupStore, in memory. Every method checks and writes in one synchronous section
  (no await between the check and the write), so two calls at the same instant cannot both take
  the last seat: the single-threaded Maps make each method atomic. Display names come from the
  fake auth store's users, as the SQL store reads them from the profiles.
*/

type MemberEntry = { role: GroupRole; status: MemberStatus; joinedAt: Date };

export type FakeGroupStoreState = {
  groups: Map<string, GroupRecord>;
  /** Group id to (user id to membership). A Map keeps joining order, which breaks joinedAt ties. */
  members: Map<string, Map<string, MemberEntry>>;
  /** Ids of soft-deleted groups. Their rows stay, as in the database, and every read skips them. */
  deleted: Set<string>;
};

const STORE_KEY = "__studyShareFakeGroupStore";

/**
 * The one state for the running process, on globalThis because Next.js can bundle server actions
 * and route handlers separately, and each bundle would otherwise get its own copy.
 */
function getState(): FakeGroupStoreState {
  const g = globalThis as unknown as Record<string, FakeGroupStoreState | undefined>;
  return (g[STORE_KEY] ??= { groups: new Map(), members: new Map(), deleted: new Set() });
}

/** Empties the shared state in place, so stores already created see the reset. */
export function resetFakeGroupStore(): void {
  const state = getState();
  state.groups.clear();
  state.members.clear();
  state.deleted.clear();
}

/** True when the group exists and is not deleted. For the other fake stores, which hang files off a group. */
export function isFakeGroupLive(groupId: string): boolean {
  const state = getState();
  return state.groups.has(groupId) && !state.deleted.has(groupId);
}

export function createFakeGroupStore(authStore: FakeAuthStore = getFakeAuthStore()): GroupStore {
  const state = getState();

  const activeCount = (groupId: string) => {
    let count = 0;
    for (const m of state.members.get(groupId)?.values() ?? []) if (m.status === "active") count++;
    return count;
  };

  /** The group when it exists and is not deleted. */
  const liveGroup = (groupId: string) => (state.deleted.has(groupId) ? undefined : state.groups.get(groupId));

  const groupsOf = (userId: string) => {
    const out: GroupRecord[] = [];
    for (const [groupId, group] of state.groups) {
      if (state.deleted.has(groupId)) continue;
      if (state.members.get(groupId)?.get(userId)?.status === "active") out.push(group);
    }
    return out;
  };

  /** True when another group (not `exceptId`) already uses this token or code. */
  const inviteTaken = (token: string, code: string, exceptId?: string) => {
    for (const g of state.groups.values()) {
      if (g.id !== exceptId && (g.inviteToken === token || g.inviteCode === code)) return true;
    }
    return false;
  };

  return {
    async createGroup(input) {
      if (groupsOf(input.ownerId).length >= GROUP_LIMITS.maxGroupsPerPerson) return { ok: false, reason: "too_many_groups" };
      if (inviteTaken(input.inviteToken, input.inviteCode)) return { ok: false, reason: "invite_taken" };
      const group: GroupRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description,
        joinMode: input.joinMode,
        passwordHash: input.passwordHash,
        inviteToken: input.inviteToken,
        inviteCode: input.inviteCode,
        createdAt: new Date(),
      };
      state.groups.set(group.id, group);
      state.members.set(group.id, new Map([[input.ownerId, { role: "owner", status: "active", joinedAt: group.createdAt }]]));
      return { ok: true, group: { ...group } };
    },

    async findByInvite(key) {
      for (const g of state.groups.values()) {
        if (state.deleted.has(g.id)) continue;
        if ("token" in key ? g.inviteToken === key.token : g.inviteCode === key.code) return { ...g };
      }
      return null;
    },

    async findById(id) {
      const group = liveGroup(id);
      return group ? { ...group } : null;
    },

    async getMembership(groupId, userId) {
      if (!liveGroup(groupId)) return null;
      const m = state.members.get(groupId)?.get(userId);
      return m ? { role: m.role, status: m.status } : null;
    },

    async listGroupsFor(userId) {
      return groupsOf(userId)
        .map((g) => ({ id: g.id, name: g.name }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    async addMember(groupId, userId) {
      const members = state.members.get(groupId);
      if (!liveGroup(groupId) || !members) return "group_gone";
      const existing = members.get(userId);
      if (existing?.status === "removed") return "removed";
      if (existing?.status === "active") return "already_member";
      if (activeCount(groupId) >= GROUP_LIMITS.maxMembers) return "full";
      if (groupsOf(userId).length >= GROUP_LIMITS.maxGroupsPerPerson) return "too_many_groups";
      members.set(userId, { role: "member", status: "active", joinedAt: new Date() });
      return "joined";
    },

    async leave(groupId, userId) {
      const members = state.members.get(groupId);
      const m = members?.get(userId);
      if (!liveGroup(groupId)) return "not_member";
      // A removed person is not a member: leaving must not clear the removal.
      if (!members || !m || m.status === "removed") return "not_member";
      if (m.role === "owner") return "owner";
      members.delete(userId);
      return "left";
    },

    async removeMember(groupId, userId) {
      if (!liveGroup(groupId)) return false;
      const m = state.members.get(groupId)?.get(userId);
      if (!m || m.role === "owner") return false;
      m.status = "removed";
      return true;
    },

    async transferOwnership(groupId, fromUserId, toUserId) {
      const members = state.members.get(groupId);
      if (!liveGroup(groupId) || !members) return "group_gone";
      const from = members.get(fromUserId);
      if (!from || from.role !== "owner" || from.status !== "active") return "not_owner";
      if (fromUserId.toLowerCase() === toUserId.toLowerCase()) return "same_person";
      const to = members.get(toUserId.toLowerCase());
      if (!to || to.status !== "active") return "not_member";
      // One synchronous section: no other call can see the group between the two writes.
      from.role = "member";
      to.role = "owner";
      return "ok";
    },

    async softDeleteGroup(groupId) {
      if (!liveGroup(groupId)) return false;
      state.deleted.add(groupId);
      return true;
    },

    async listMembers(groupId) {
      const rows: MemberRow[] = [];
      if (!liveGroup(groupId)) return rows;
      for (const [userId, m] of state.members.get(groupId) ?? []) {
        if (m.status !== "active") continue;
        rows.push({ userId, displayName: authStore.users.get(userId)?.displayName ?? "", role: m.role, joinedAt: m.joinedAt });
      }
      // Array.prototype.sort is stable, so equal times keep joining order.
      return rows.sort((a, b) => {
        if ((a.role === "owner") !== (b.role === "owner")) return a.role === "owner" ? -1 : 1;
        return a.joinedAt.getTime() - b.joinedAt.getTime();
      });
    },

    async updateDetails(groupId, d) {
      const group = liveGroup(groupId);
      if (!group) return false;
      group.name = d.name;
      group.description = d.description;
      return true;
    },

    async updateJoin(groupId, j) {
      const group = liveGroup(groupId);
      if (!group) return false;
      group.joinMode = j.joinMode;
      group.passwordHash = j.passwordHash;
      return true;
    },

    async replaceInvite(groupId, i) {
      const group = liveGroup(groupId);
      if (!group) return "group_gone";
      if (inviteTaken(i.inviteToken, i.inviteCode, groupId)) return "invite_taken";
      group.inviteToken = i.inviteToken;
      group.inviteCode = i.inviteCode;
      return "ok";
    },
  };
}
