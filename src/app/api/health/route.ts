import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { checkHealth } from "@/server/health";

export async function GET() {
  // getDb() reads the environment inside the ping, so a missing variable
  // becomes a 503 instead of a crash.
  const { httpStatus, body } = await checkHealth(async () => {
    await getDb().execute(sql`select 1`);
  });
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
