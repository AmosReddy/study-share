/**
 * Port: what the app needs from file storage. Nothing here names a vendor.
 * Application code depends on this interface only. The implementation lives in
 * src/server/adapters and is chosen in src/server/services.ts.
 */
export interface FileStorage {
  /** A short-lived URL the browser can PUT one file to. The file's type and size are bound to the URL. */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;

  /** A short-lived URL for reading one file. Downloads by default. Use "inline" only for safe previews. */
  createDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    downloadName?: string;
    disposition?: "attachment" | "inline";
  }): Promise<string>;

  /** Size and type of a stored file, or null when it does not exist. */
  head(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>;

  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;

  /** The file's bytes, or null when it does not exist. */
  get(key: string): Promise<Uint8Array | null>;

  /** Deleting a file that does not exist is not an error. */
  delete(key: string): Promise<void>;
}
