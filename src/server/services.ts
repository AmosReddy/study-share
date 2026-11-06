import "server-only";
import { createSmtpEmailSenderFromConfig } from "@/server/adapters/smtp-email-sender";
import { createS3FileStorage } from "@/server/adapters/s3-file-storage";
import { getServerEnv } from "@/server/env";
import type { EmailSender } from "@/server/ports/email-sender";
import type { FileStorage } from "@/server/ports/file-storage";

/**
 * Composition root: the only place that decides which implementation backs
 * each port. Application code calls getFileStorage() and getEmailSender() and
 * never learns which vendor is behind them.
 *
 * To switch a vendor: change its settings (STORAGE_* or SMTP_*). To add a vendor
 * that is not S3 or SMTP compatible: write a new adapter and choose it here.
 */

let storage: FileStorage | undefined;
let email: EmailSender | undefined;

export function getFileStorage(): FileStorage {
  if (!storage) {
    const env = getServerEnv();
    storage = createS3FileStorage({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      bucket: env.STORAGE_BUCKET,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    });
  }
  return storage;
}

export function getEmailSender(): EmailSender {
  if (!email) {
    const env = getServerEnv();
    email = createSmtpEmailSenderFromConfig({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    });
  }
  return email;
}
