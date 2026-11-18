import { servePrivateSummary } from "./serve-private-summary";

/** The person's private chats and unread dots as JSON, for the Private list's polling (see serve-private-summary.ts). */
export async function GET(_request: Request, context: RouteContext<"/groups/[id]/chat/private/summary">) {
  return servePrivateSummary(context.params);
}
