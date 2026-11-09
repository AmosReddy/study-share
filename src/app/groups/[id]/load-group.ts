import "server-only";
import { cache } from "react";
import { requireAcceptedTerms } from "@/server/auth/session";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { viewGroup } from "@/server/groups/use-cases";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The signed-in person and the group, for the group layout and its pages. Signed out goes to log
 * in (and back here afterwards); signed in without the terms goes to /welcome. Null for a
 * non-member, a removed member, a deleted or unknown group and a malformed id alike: the caller
 * answers each of them with the same notFound(). Cached for one request, so the layout and the
 * page share one lookup.
 */
export const loadGroupPage = cache(async (groupId: string) => {
  const next = UUID.test(groupId) ? `/groups/${groupId}` : "/";
  const user = await requireAcceptedTerms(next);
  const deps = await requireGroupDeps(next);
  const view = await viewGroup(deps, groupId);
  return view ? { user, deps, group: view.group, membership: view.membership } : null;
});
