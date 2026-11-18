import type { NextRequest } from "next/server";
import { serveDirectMessages } from "./serve-direct-messages";

/** A private chat's messages as JSON, for the conversation page's polling (see serve-direct-messages.ts). */
export async function GET(request: NextRequest, context: RouteContext<"/groups/[id]/chat/private/[chatId]/messages">) {
  return serveDirectMessages(context.params, request);
}
