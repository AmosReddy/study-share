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

  /**
   * A short-lived URL for reading one file. It downloads by default.
   *
   * Pass `preview` to ask for the file to be shown in the browser instead. Pass the
   * type that WE verified when the file was uploaded, never one the uploader claimed.
   * The storage adapter still shows only PDFs and common images inline and turns
   * everything else (HTML, SVG, scripts) into a download, so a bad type cannot
   * run code from the storage address.
   */
  createDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    downloadName?: string;
    preview?: { contentType: string };
  }): Promise<string>;

  /** Size and type of a stored file, or null when it does not exist. */
  head(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>;

  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;

  /**
   * The file's bytes, or null when it does not exist. With `range` only those bytes come back
   * (both ends included; an end past the file's end is cut short), so a caller can look at the
   * start of a large file without reading all of it. The file must not be empty.
   */
  get(key: string, options?: { range?: { start: number; endInclusive: number } }): Promise<Uint8Array | null>;

  /** Deleting a file that does not exist is not an error. */
  delete(key: string): Promise<void>;
}
