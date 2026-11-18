import "server-only";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { getServerEnv } from "@/server/env";
import { getDirectChatStore } from "@/server/services";
import type { DirectChatDeps } from "./direct-use-cases";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The private chat use-cases' dependencies for a page, action or route in one group: the group
 * dependencies (a signed-in person who has accepted the terms; anyone else is redirected to log in
 * or to /welcome and returned to the group's page) plus the private chat store and the secret the
 * chat keys are made with (the service-role key, as the pending sign-up cookie uses it). The
 * session and headers are read before any setting, as in requireGroupDeps.
 */
export async function requireDirectChatDeps(groupId: string): Promise<DirectChatDeps> {
  const next = UUID.test(groupId) ? `/groups/${groupId}` : "/";
  const deps = await requireGroupDeps(next);
  return { ...deps, direct: getDirectChatStore(), secret: getServerEnv().SUPABASE_SERVICE_ROLE_KEY };
}
