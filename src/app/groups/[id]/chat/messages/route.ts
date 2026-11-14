import type { NextRequest } from "next/server";
import { serveMessages } from "./serve-messages";

/** The chat's messages as JSON, for the page's polling (see serve-messages.ts). */
export async function GET(request: NextRequest, context: RouteContext<"/groups/[id]/chat/messages">) {
  return serveMessages(context.params, request);
}
