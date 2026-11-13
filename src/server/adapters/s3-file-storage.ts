import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition, safeInlineType } from "@/server/adapters/file-disposition";
import type { FileStorage } from "@/server/ports/file-storage";

export type S3Config = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

/** The parts of the vendor's response that we read. */
type StoredObject = {
  ContentLength?: number;
  ContentType?: string;
  Body?: { transformToByteArray(): Promise<Uint8Array> };
};

/** The one method we use from the vendor client, so tests can pass a stand-in. */
type Sender = { send: (command: never) => Promise<unknown> };

/**
 * Adapter: any S3-compatible storage (Supabase Storage, Cloudflare R2, AWS S3).
 * Switching vendors means changing the STORAGE_* settings, not this code.
 */
export function createS3FileStorage(config: S3Config, sender?: Sender): FileStorage {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  // Signing always uses the real client. Only network calls can be swapped.
  const send = (command: unknown) => (sender ?? client).send(command as never) as Promise<StoredObject>;
  const Bucket = config.bucket;

  // A missing bucket is a setup mistake, not a missing file, so it is not treated as "not found".
  const isMissing = (error: unknown) => error instanceof Error && ["NotFound", "NoSuchKey"].includes(error.name);

  return {
    async createUploadUrl({ key, contentType, sizeBytes, expiresInSeconds }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
        { expiresIn: expiresInSeconds, signableHeaders: new Set(["content-type"]) },
      );
      return { url, headers: { "Content-Type": contentType } };
    },

    async createDownloadUrl({ key, expiresInSeconds, downloadName, preview }) {
      const inlineType = safeInlineType(preview?.contentType);
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(inlineType ? "inline" : "attachment", downloadName),
          // For a preview, tell the browser the exact safe type rather than trusting what is stored.
          ...(inlineType ? { ResponseContentType: inlineType } : {}),
        }),
        { expiresIn: expiresInSeconds },
      );
    },

    async head(key) {
      try {
        const result = await send(new HeadObjectCommand({ Bucket, Key: key }));
        return { sizeBytes: Number(result.ContentLength ?? 0), contentType: result.ContentType };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async put(key, body, contentType) {
      await send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async get(key, options) {
      const range = options?.range;
      try {
        const result = await send(
          new GetObjectCommand({
            Bucket,
            Key: key,
            // HTTP ranges are inclusive at both ends, as `endInclusive` is.
            ...(range ? { Range: `bytes=${range.start}-${range.endInclusive}` } : {}),
          }),
        );
        return (await result.Body?.transformToByteArray()) ?? null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      await send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
