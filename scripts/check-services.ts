/**
 * Verifies that every external service is reachable with the credentials in
 * .env.local. Run with: npm run check:services
 *
 * Prints PASS or FAIL per service and exits non-zero if any fails. Error output
 * is limited to the error's name and message so credentials are not printed.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "@/server/db/client";
import { EnvError, getServerEnv, type ServerEnv } from "@/server/env";

async function checkDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

async function checkR2(env: ServerEnv): Promise<void> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const Key = `healthcheck/${Date.now()}.txt`;
  const Body = `check ${Key}`;
  try {
    await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key, Body }));
    const object = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key }));
    const text = await object.Body?.transformToString();
    if (text !== Body) throw new Error("Downloaded content did not match what was uploaded");
  } finally {
    // Always try to clean up, even when the read failed.
    await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key })).catch(() => {});
  }
}

async function checkSmtp(env: ServerEnv): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
  });
  await transporter.verify();
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
}

async function main(): Promise<void> {
  let env: ServerEnv;
  try {
    env = getServerEnv();
  } catch (error) {
    console.log(`FAIL  environment  ${error instanceof EnvError ? error.message : describeError(error)}`);
    process.exit(1);
  }

  const checks: [string, () => Promise<void>][] = [
    ["database", checkDatabase],
    ["R2 storage", () => checkR2(env)],
    ["Gmail SMTP", () => checkSmtp(env)],
  ];

  let failed = false;
  for (const [name, run] of checks) {
    try {
      await run();
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed = true;
      console.log(`FAIL  ${name}  ${describeError(error)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
