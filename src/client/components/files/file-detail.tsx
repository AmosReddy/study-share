import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/client/components/ui/button";
import { formatBytes, formatFileDate } from "@/shared/format";

/** One file as the page shows it (the server's FileView has at least these fields). */
export type FileInfo = {
  id: string;
  title: string;
  subject: string;
  typeLabel: string;
  fileName: string;
  sizeBytes: number;
  uploaderName: string;
  uploadedAt: string;
  previewable: boolean;
  isPdf: boolean;
};

type FileDetailProps = {
  groupId: string;
  file: FileInfo;
  /** The "Edit details" and "Delete file" sections (already built for what the person may do). */
  children?: ReactNode;
};

/**
 * One file: its title and details, Download, and the preview. The preview and download links
 * point at this app's own routes (…/content and …/download), which check the person's membership
 * and answer with a fresh short-lived storage link each time. No storage address or key is in
 * this page, so a page left open for an hour still works.
 */
export function FileDetail({ groupId, file, children }: FileDetailProps) {
  const base = `/groups/${groupId}/files/${file.id}`;
  const contentHref = `${base}/content`;

  return (
    <article aria-labelledby="file-title" className="flex min-w-0 flex-col gap-6">
      <Link
        href={`/groups/${groupId}`}
        className="inline-flex min-h-11 items-center gap-2 self-start font-medium underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the library
      </Link>

      <header className="flex min-w-0 flex-col gap-3">
        <h1 id="file-title" className="text-2xl leading-tight font-semibold [overflow-wrap:anywhere]">
          {file.title}
        </h1>
        <p data-testid="file-meta" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {file.typeLabel}
          </span>
          {file.subject ? <span className="[overflow-wrap:anywhere]">{file.subject}</span> : null}
          <span className="[overflow-wrap:anywhere]">Shared by {file.uploaderName}</span>
          <span>{formatBytes(file.sizeBytes)}</span>
          <span>{formatFileDate(file.uploadedAt)}</span>
        </p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{file.fileName}</p>
        <Button asChild className="h-11 gap-2 self-start px-5 text-base">
          {/* A plain link, not next/link: the answer is a redirect to the file, not a page to prefetch. */}
          <a href={`${base}/download`}>
            <Download className="size-4" aria-hidden="true" />
            Download
          </a>
        </Button>
      </header>

      {file.previewable ? (
        <section aria-label="Preview" className="flex min-w-0 flex-col gap-3">
          {file.isPdf ? (
            <iframe
              src={contentHref}
              title={`Preview of ${file.title}`}
              data-testid="file-preview"
              className="h-[70dvh] min-h-80 w-full rounded-lg border bg-card"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- the address redirects to a fresh private link on every load, which the image optimizer cannot follow
            <img
              src={contentHref}
              alt={file.title}
              data-testid="file-preview"
              className="max-h-[70dvh] max-w-full self-start rounded-lg border bg-card object-contain"
            />
          )}
          <a
            href={contentHref}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center gap-2 self-start font-medium underline underline-offset-4"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open in a new tab
          </a>
        </section>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-muted-foreground">
          This kind of file can&apos;t be shown in the browser. Use Download to open it on your device.
        </p>
      )}

      {children}
    </article>
  );
}

