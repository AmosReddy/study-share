import "server-only";
import { cache } from "react";
import type { AuthUser } from "@/server/ports/auth-provider";
import type { GroupSummary } from "@/server/ports/group-store";
import { getGroupStore, getRateLimiter } from "@/server/services";
import { getSiteUrl } from "@/server/site-url";
import { listMyGroups } from "./use-cases";

/**
 * The groups the person is an active member of, for the shell's group list and the home page.
 * Cached for one request, so the frame and the page share one lookup. Only reads: no limiter
 * hit and no address is needed, so the network address is left empty.
 */
const groupsFor = cache((userId: string, displayName: string): Promise<GroupSummary[]> =>
  listMyGroups({
    groups: getGroupStore(),
    limiter: getRateLimiter(),
    siteUrl: getSiteUrl(),
    ip: "",
    user: { id: userId, displayName },
  }),
);

export function loadShellGroups(user: Pick<AuthUser, "id" | "displayName">): Promise<GroupSummary[]> {
  return groupsFor(user.id, user.displayName);
}
