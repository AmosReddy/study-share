import type { NextRequest } from "next/server";
import { redirectToFile } from "../serve-file";

/** The download of any file: a redirect to a fresh short-lived link that saves it (see serve-file.ts). */
export async function GET(_request: NextRequest, context: RouteContext<"/groups/[id]/files/[fileId]/download">) {
  return redirectToFile(context.params, { download: true });
}
