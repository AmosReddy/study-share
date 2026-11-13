import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteFile } from "@/client/components/files/delete-file";
import { EditFileForm } from "@/client/components/files/edit-file-form";
import { FileDetail } from "@/client/components/files/file-detail";
import { Skeleton } from "@/client/components/ui/skeleton";
import { requireFileDeps } from "@/server/files/request-deps";
import { getFile, listFiles } from "@/server/files/use-cases";
import { deleteFileAction, updateFileAction } from "../../../file-actions";

export default function FilePage({ params }: PageProps<"/groups/[id]/files/[fileId]">) {
  return (
    <Suspense fallback={<FileSkeleton />}>
      <FileContent params={params} />
    </Suspense>
  );
}

const sectionHeading = "text-xl font-semibold";

/**
 * One file. A non-member, a removed member, a file that is gone, still uploading or in another
 * group, and an address that is not a file at all get the same not-found page as the group layout.
 */
async function FileContent({ params }: Pick<PageProps<"/groups/[id]/files/[fileId]">, "params">) {
  const { id, fileId } = await params;
  const deps = await requireFileDeps(id);
  const file = await getFile(deps, id, fileId);
  if (!file) notFound();
  // The subjects the group uses are suggestions in the edit form, so only the uploader needs them.
  const subjects = file.canEdit ? ((await listFiles(deps, id))?.subjects ?? []) : [];

  return (
    <FileDetail groupId={id} file={file}>
      {file.canEdit ? (
        <section aria-labelledby="edit-heading" className="flex flex-col gap-4">
          <h2 id="edit-heading" className={sectionHeading}>
            Edit details
          </h2>
          <EditFileForm
            groupId={id}
            fileId={file.id}
            title={file.title}
            subject={file.subject}
            type={file.type}
            subjects={subjects}
            action={updateFileAction}
          />
        </section>
      ) : null}
      {file.canDelete ? (
        <section aria-labelledby="delete-heading" className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4">
          <h2 id="delete-heading" className={sectionHeading}>
            Delete file
          </h2>
          <p className="text-muted-foreground">
            {file.canEdit
              ? "Remove this file for everyone in the group."
              : "You can delete this file because you own the group."}
          </p>
          <DeleteFile groupId={id} fileId={file.id} title={file.title} byOwner={!file.canEdit} action={deleteFileAction} />
        </section>
      ) : null}
    </FileDetail>
  );
}

function FileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-11 w-40" />
      <Skeleton className="h-9 w-3/4 max-w-md" />
      <Skeleton className="h-11 w-36" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
