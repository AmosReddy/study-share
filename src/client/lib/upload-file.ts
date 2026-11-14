/*
  Sends one file to a short-lived storage link with a PUT, reporting progress. XMLHttpRequest, not
  fetch, because only it reports how much of the body has been sent. The request carries exactly the
  headers the server returned: no cookies (it may be another origin), no extra headers (the link is
  signed for those), nothing else.
*/

/** The part of XMLHttpRequest this uses, so a test can stand in for it. */
export type UploadRequest = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  status: number;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  timeout: number;
  withCredentials: boolean;
};

/** A whole percent from 0 to 100; 0 when the total is not known. */
export function percentSent(loaded: number, total: number): number {
  if (!(total > 0) || !(loaded > 0)) return 0;
  return Math.min(100, Math.floor((loaded / total) * 100));
}

export type PutResult = { ok: true } | { ok: false; status: number };

/** How long one upload may take in all before it counts as failed. */
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * PUTs `file` to `url` with `headers`. Resolves { ok: true } for a 2xx answer, and
 * { ok: false, status } for anything else (status 0: the network failed or it timed out).
 * Never rejects. `onProgress` gets 0 to 100.
 */
export function putFile(
  file: Blob,
  url: string,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
  createRequest: () => UploadRequest = () => new XMLHttpRequest() as unknown as UploadRequest,
): Promise<PutResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PutResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const request = createRequest();
      request.open("PUT", url);
      for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
      request.withCredentials = false;
      request.timeout = UPLOAD_TIMEOUT_MS;
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(percentSent(event.loaded, event.total));
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress(100);
          finish({ ok: true });
        } else {
          finish({ ok: false, status: request.status });
        }
      };
      request.onerror = () => finish({ ok: false, status: 0 });
      request.onabort = () => finish({ ok: false, status: 0 });
      request.ontimeout = () => finish({ ok: false, status: 0 });
      request.send(file);
    } catch {
      finish({ ok: false, status: 0 });
    }
  });
}
