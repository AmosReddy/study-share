import type { NextRequest } from "next/server";
import { redirectToFile } from "../serve-file";

/** The inline preview of a PDF or image: a redirect to a fresh short-lived link (see serve-file.ts). */
export async function GET(_request: NextRequest, context: RouteContext<"/groups/[id]/files/[fileId]/content">) {
  return redirectToFile(context.params, { download: false });
}
