import "server-only";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { getMessageStore } from "@/server/services";
import type { ChatDeps } from "./use-cases";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The chat use-cases' dependencies for a page, action or route in one group: the group
 * dependencies (a signed-in person who has accepted the terms; anyone else is redirected to log in
 * or to /welcome and returned to the group's page) plus the message store. The session and headers
 * are read before any setting, as in requireGroupDeps.
 */
export async function requireChatDeps(groupId: string): Promise<ChatDeps> {
  const next = UUID.test(groupId) ? `/groups/${groupId}` : "/";
  const deps = await requireGroupDeps(next);
  return { ...deps, messages: getMessageStore() };
}
