import { connection, NextResponse } from "next/server";
import { pingDatabase } from "@/server/db/ping";
import { checkHealth } from "@/server/health";

export async function GET() {
  // A health check must run on every request, never at build time (where there are no
  // settings and no database), so wait for a real request first.
  await connection();
  // pingDatabase() reads the environment inside the check, so a missing
  // variable becomes a 503 instead of a crash.
  const { httpStatus, body } = await checkHealth(pingDatabase);
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
