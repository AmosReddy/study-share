import { NextResponse } from "next/server";
import { pingDatabase } from "@/server/db/ping";
import { checkHealth } from "@/server/health";

export async function GET() {
  // pingDatabase() reads the environment inside the check, so a missing
  // variable becomes a 503 instead of a crash.
  const { httpStatus, body } = await checkHealth(pingDatabase);
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
