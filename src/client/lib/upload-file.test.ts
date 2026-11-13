import { describe, expect, it, vi } from "vitest";
import { percentSent, putFile, type UploadRequest } from "./upload-file";

function fakeRequest(behaviour: (request: UploadRequest) => void) {
  const headers: Record<string, string> = {};
  const calls: { method?: string; url?: string; body?: Blob } = {};
  const request: UploadRequest = {
    open: (method, url) => void Object.assign(calls, { method, url }),
    setRequestHeader: (name, value) => void (headers[name] = value),
    send: (body) => {
      calls.body = body;
      behaviour(request);
    },
    status: 0,
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    onabort: null,
    ontimeout: null,
    timeout: 0,
    withCredentials: true,
  };
  return { request, headers, calls };
}

describe("percentSent", () => {
  it("is a whole percent, between 0 and 100", () => {
    expect(percentSent(0, 100)).toBe(0);
    expect(percentSent(42.9, 100)).toBe(42);
    expect(percentSent(100, 100)).toBe(100);
    expect(percentSent(150, 100)).toBe(100);
  });

  it("is 0 when nothing is known", () => {
    expect(percentSent(10, 0)).toBe(0);
    expect(percentSent(Number.NaN, 100)).toBe(0);
    expect(percentSent(-5, 100)).toBe(0);
  });
});

describe("putFile", () => {
  const file = new Blob(["hello"], { type: "text/plain" });

  it("sends a PUT with exactly the given headers and no credentials, and reports progress", async () => {
    const t = fakeRequest((request) => {
      request.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 5 });
      request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
      request.status = 200;
      request.onload?.();
    });
    const progress = vi.fn();
    const result = await putFile(file, "https://storage.test/a?sig=1", { "Content-Type": "text/plain" }, progress, () => t.request);
    expect(result).toEqual({ ok: true });
    expect(t.calls).toMatchObject({ method: "PUT", url: "https://storage.test/a?sig=1", body: file });
    expect(t.headers).toEqual({ "Content-Type": "text/plain" });
    expect(t.request.withCredentials).toBe(false);
    expect(progress.mock.calls.map((call) => call[0])).toEqual([40, 100]);
  });

  it("reports a refused upload with its status", async () => {
    const t = fakeRequest((request) => {
      request.status = 403;
      request.onload?.();
    });
    expect(await putFile(file, "u", {}, () => {}, () => t.request)).toEqual({ ok: false, status: 403 });
  });

  it("reports a network failure and a timeout as status 0, and settles only once", async () => {
    for (const event of ["onerror", "ontimeout", "onabort"] as const) {
      const t = fakeRequest((request) => {
        request[event]?.();
        request.status = 200;
        request.onload?.();
      });
      expect(await putFile(file, "u", {}, () => {}, () => t.request)).toEqual({ ok: false, status: 0 });
    }
  });

  it("never rejects, even when the request cannot be made", async () => {
    const result = await putFile(file, "u", {}, () => {}, () => {
      throw new Error("no XHR");
    });
    expect(result).toEqual({ ok: false, status: 0 });
  });
});
