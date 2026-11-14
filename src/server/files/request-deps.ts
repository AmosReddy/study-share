import "server-only";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { getFileStorage, getResourceStore } from "@/server/services";
import type { FileDeps } from "./use-cases";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The file use-cases' dependencies for a page or action in one group: the group dependencies
 * (a signed-in person who has accepted the terms; anyone else is redirected to log in or to
 * /welcome and returned to the group's page) plus the file store and file storage. The session
 * and headers are read before any setting, as in requireGroupDeps.
 */
export async function requireFileDeps(groupId: string): Promise<FileDeps> {
  const next = UUID.test(groupId) ? `/groups/${groupId}` : "/";
  const deps = await requireGroupDeps(next);
  return { ...deps, resources: getResourceStore(), storage: getFileStorage() };
}
