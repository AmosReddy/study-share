import { ChevronRight, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { FormMessage } from "@/client/components/auth/form-message";
import { Button } from "@/client/components/ui/button";
import { FILE_MESSAGES } from "@/shared/file-messages";
import { formatBytes, formatFileDate } from "@/shared/format";

/** One file as the page shows it (the server's FileView has at least these fields). */
export type LibraryFile = {
  id: string;
  title: string;
  subject: string;
  typeLabel: string;
  sizeBytes: number;
  uploaderName: string;
  uploadedAt: string;
};

type FileLibraryProps = {
  groupId: string;
  files: LibraryFile[];
  /** The cursor of the next page, or null on the last page. */
  nextCursor: string | null;
  /** True on a page reached through "Show more"; offers the way back to the newest files. */
  later: boolean;
  /** A message from the page that sent the person here (a file was shared or deleted). */
  notice?: "uploaded" | "deleted";
};

const badgeClass = "shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-foreground";

/** The Library tab: the group's files, newest first, with the Upload button. */
export function FileLibrary({ groupId, files, nextCursor, later, notice }: FileLibraryProps) {
  const base = `/groups/${groupId}`;
  return (
    <section aria-labelledby="library-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 id="library-heading" className="text-xl font-semibold">
          Library
        </h2>
        <UploadButton href={`${base}/upload`} />
      </div>

      {notice ? <FormMessage tone="success" title={FILE_MESSAGES.notices[notice]} /> : null}

      {files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-xl font-semibold">No files yet</h3>
          <p className="max-w-prose text-muted-foreground">Be the first to share something.</p>
          <UploadButton href={`${base}/upload`} />
        </div>
      ) : (
        <ul aria-label="Files" className="flex flex-col gap-2">
          {files.map((file) => (
            <li key={file.id} className="min-w-0">
              <Link
                href={`${base}/files/${file.id}`}
                className="flex min-h-11 min-w-0 items-start gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="font-medium [overflow-wrap:anywhere]">{file.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <span className={badgeClass}>{file.typeLabel}</span>
                    {file.subject ? <span className="[overflow-wrap:anywhere]">{file.subject}</span> : null}
                    <span className="[overflow-wrap:anywhere]">{file.uploaderName}</span>
                    <span>{formatBytes(file.sizeBytes)}</span>
                    <span>{formatFileDate(file.uploadedAt)}</span>
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nextCursor || later ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {nextCursor ? (
            <Button asChild variant="outline" className="h-11 w-full px-5 text-base sm:w-auto">
              <Link href={`${base}?cursor=${encodeURIComponent(nextCursor)}`}>Show more</Link>
            </Button>
          ) : null}
          {later ? (
            <Button asChild variant="ghost" className="h-11 w-full px-5 text-base sm:w-auto">
              <Link href={base}>Back to the newest files</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function UploadButton({ href }: { href: string }) {
  return (
    <Button asChild className="h-11 gap-2 px-5 text-base">
      <Link href={href}>
        <Upload className="size-4" aria-hidden="true" />
        Upload a file
      </Link>
    </Button>
  );
}
